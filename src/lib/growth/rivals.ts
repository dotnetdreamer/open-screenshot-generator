// Competitors: App Store apps the user follows, read with Apple's public
// lookup service, the one the screenshot import and the ratings sweep already
// call (src/lib/intake/appStoreLookup.ts, itunes.ts). It needs no key and
// answers any web page, so this part of Growth works in the web build too.
// In the desktop app the user can also follow Google Play apps, read from
// their public store pages (playPage.ts); an id of `play:` and a package
// names one, as everywhere else in Growth (stores.ts).
//
// The lookup takes several ids in one request, so one request per country
// covers every followed App Store app and the user's own. Google Play takes
// one page per app and country. What each app showed in each country is kept
// (RivalSnapshot), and the next check compares with it (diffStorefront):
//
//   screenshots   the iPhone set and the iPad set (on Google Play, the one
//                 set its page shows), compared by the picture each address
//                 names. Apple serves one picture from the hosts is1-ssl to
//                 is5-ssl, and both stores at whatever size the address asks
//                 for, so the host and the size are left out (assetKey).
//   version       a new version, with its release notes
//   update        a later update day with no new version number, with its
//                 "What's new": how an update shows for a Google Play app
//                 whose page has no version
//   name, icon    a new app name or icon
//   price         the price in that country, kept once two checks agree
//
// Apple's CDN keeps a lookup answer for up to a day, and two of its servers
// can hold different copies, so a check can get an answer older than the one
// before it. An answer for a version released before the version already
// kept is such a copy, and is skipped. New App Store screenshots normally
// ship with a new version, so the same rule keeps a stale copy from bringing
// old screenshots back as a change. Price is the one field that changes
// without a version, which is why a new price waits for a second check.
//
// This file holds the parts without storage. rivalWatch.ts keeps the lists,
// the answers and the changes in the growth database, and runs the checks.

import { bridgeFetch } from '@/lib/account/transport';
import { parseStoreLink } from '@/lib/intake/appStoreLookup';
import { throwIfAborted } from './http';
import { lookupTurn } from './itunes';
import { PlayPageUnreadable, canReadGooglePlay, fetchPlayStorefront } from './playPage';
import { playAppId, type GrowthStore } from './stores';
import { TERRITORY_CODES } from './territories';

/** "A few rival apps": enough to cover a category's leaders, few enough to compare on one screen. */
export const MAX_RIVALS = 10;
/** Each country is one request, and Apple asks for at most 20 a minute. */
export const MAX_RIVAL_COUNTRIES = 20;
/** Countries a new list starts with after the app's own busiest ones. */
export const DEFAULT_RIVAL_COUNTRIES = ['US', 'GB', 'DE', 'FR', 'JP', 'BR', 'IN', 'CA'];
const NEW_LIST_COUNTRIES = 8;
/** How often the followed apps are looked up again: twice a day. */
export const RIVAL_CHECK_EVERY_MS = 12 * 3_600_000;
/** Ids per lookup request. Apple takes more; ten apps and your own never need a second request. */
const IDS_PER_LOOKUP = 50;

const LOOKUP_URL = 'https://itunes.apple.com/lookup';
const SEARCH_URL = 'https://itunes.apple.com/search';

/** One app in one country, as the lookup answered. */
export interface RivalStorefront {
  territory: string;
  name: string;
  developer: string;
  genre: string;
  version: string;
  /** When the version came out, as Apple dates it (an ISO timestamp). */
  releasedAt: string | null;
  releaseNotes: string;
  rating: number | null;
  ratingCount: number | null;
  price: number | null;
  /** The price as the store prints it there: "Free", "Gratis", "$2.99". */
  priceLabel: string;
  currency: string | null;
  iconUrl: string | null;
  screenshots: string[];
  ipadScreenshots: string[];
  storeUrl: string | null;
  /** When a check last found the app in this country, in ms. */
  seenAt: number;
  /** When a check last got an answer without the app in this country, so what is kept is from seenAt. */
  missingAt?: number;
  /** A new price seen once, kept here until the next check shows it again. */
  pendingPrice?: { price: number | null; priceLabel: string; currency: string | null };
}

/** Everything known about one app, by country. Null where a check found the app is not sold. */
export interface RivalSnapshot {
  id: string;
  countries: Record<string, RivalStorefront | null>;
  checkedAt: number;
}

export type RivalChangeKind = 'screenshots' | 'ipad-screenshots' | 'version' | 'update' | 'name' | 'icon' | 'price';

/** A change one check found, with every country that showed the same before and after. */
export interface RivalChange {
  /** Stable, so the change can be marked as seen. */
  id: string;
  appId: string;
  kind: RivalChangeKind;
  /** When the check that found it ran, in ms. */
  foundAt: number;
  territories: string[];
  /** Screenshots and icons: addresses. Version, name, price: one value each. Update: the update days. */
  before: string[];
  after: string[];
  /** A new version's release notes, or an update's "What's new". */
  notes?: string;
}

/** The changes worth an alert: new screenshots, on either store. */
export function isScreenshotChange(change: Pick<RivalChange, 'kind'>): boolean {
  return change.kind === 'screenshots' || change.kind === 'ipad-screenshots';
}

/** A followed app, as the list names it until a check reads it again. */
export interface RivalEntry {
  id: string;
  name: string;
  developer: string;
  iconUrl: string | null;
  addedAt: number;
}

/**
 * The apps one of the user's apps is up against, and where to look. A list
 * belongs to the app Growth shows (its id), or to no app at all (an empty
 * owner) in the web build and on a desktop with no store key.
 */
export interface RivalList {
  owner: string;
  rivals: RivalEntry[];
  /** Countries, two letter codes, in the order the user put them. */
  countries: string[];
  /**
   * The user's own app on the App Store or Google Play, for a list with no
   * Growth app to compare with: the web build has no key to name one.
   */
  yourApp?: RivalEntry;
  /** When a check last got answers, in ms. */
  checkedAt?: number;
  /** When a check last got no answer at all, so the next try waits a while. */
  failedAt?: number;
  /**
   * The stores that did not answer for every app and country in the last
   * check of their apps. The apps of such a store are looked at again an hour
   * later, and the screen says so until a check of that store's apps gets
   * every answer.
   */
  trouble?: Partial<Record<GrowthStore, StoreTrouble>>;
}

/** A store that left gaps in a check. */
export interface StoreTrouble {
  at: number;
  /** Countries where the store did not answer for one app at least. */
  countries: number;
  /**
   * Google Play: a page came back without the details where Growth reads
   * them, which is what a change to Google's pages looks like.
   */
  unreadable: boolean;
}

/** An app a search or a pasted link found, to follow. */
export interface RivalCandidate {
  id: string;
  name: string;
  developer: string;
  iconUrl: string | null;
  genre: string;
  rating: number | null;
  ratingCount: number | null;
  priceLabel: string;
  screenshots: string[];
  /**
   * Everything the search answered, for the country it searched: a search
   * answers with the same fields as a lookup, so an app just followed shows
   * in that country before its first check.
   */
  storefront: RivalStorefront;
}

/** An app a check can read: an App Store id (all digits), or `play:` and a Google Play package. */
export function isRivalAppId(id: string | null | undefined): id is string {
  return !!id && (/^\d+$/.test(id) || /^play:[A-Za-z]\w*(\.\w+)+$/.test(id));
}

/** The id of the user's own app in a list: the owner itself, or the app named in it. */
export function ownAppId(list: Pick<RivalList, 'owner' | 'yourApp'>): string | null {
  if (isRivalAppId(list.owner)) return list.owner;
  const named = list.yourApp?.id;
  return isRivalAppId(named) ? named : null;
}

/** A found app as a list keeps it. */
export function entryOf(candidate: RivalCandidate, addedAt = Date.now()): RivalEntry {
  return { id: candidate.id, name: candidate.name, developer: candidate.developer, iconUrl: candidate.iconUrl, addedAt };
}

// --- the lookup ---------------------------------------------------------------

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
}

function rowsOf(body: unknown): Array<Record<string, unknown>> {
  const results = (body as { results?: unknown })?.results;
  return Array.isArray(results)
    ? results.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object' && (row as { trackId?: unknown }).trackId !== undefined)
    : [];
}

/** One app of a lookup answer, in one country. Null for a row that is not an app. */
export function readStorefront(row: Record<string, unknown>, territory: string, seenAt: number): RivalStorefront | null {
  if (row.kind !== undefined && row.kind !== 'software' && row.wrapperType !== 'software') return null;
  const name = text(row.trackName);
  if (!name) return null;
  const price = numberOrNull(row.price);
  return {
    territory,
    name,
    developer: text(row.artistName) || text(row.sellerName),
    genre: text(row.primaryGenreName),
    version: text(row.version),
    releasedAt: text(row.currentVersionReleaseDate) || null,
    releaseNotes: text(row.releaseNotes),
    rating: numberOrNull(row.averageUserRating),
    ratingCount: numberOrNull(row.userRatingCount),
    price,
    priceLabel: text(row.formattedPrice) || (price === 0 ? 'Free' : ''),
    currency: text(row.currency) || null,
    iconUrl: text(row.artworkUrl512) || text(row.artworkUrl100) || null,
    screenshots: strings(row.screenshotUrls),
    ipadScreenshots: strings(row.ipadScreenshotUrls),
    storeUrl: text(row.trackViewUrl) || null,
    seenAt,
  };
}

function candidateOf(storefront: RivalStorefront, id: string): RivalCandidate {
  return {
    id,
    name: storefront.name,
    developer: storefront.developer,
    iconUrl: storefront.iconUrl,
    genre: storefront.genre,
    rating: storefront.rating,
    ratingCount: storefront.ratingCount,
    priceLabel: storefront.priceLabel,
    screenshots: storefront.screenshots,
    storefront,
  };
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  throwIfAborted(signal);
  const doFetch = await bridgeFetch();
  // no-store: the browser would otherwise keep each answer for the day
  // Apple's Cache-Control allows, and a check would read its own last copy.
  const response = await doFetch(url, { method: 'GET', cache: 'no-store' });
  throwIfAborted(signal);
  if (!response.ok) throw new Error(`The App Store lookup answered HTTP ${response.status}`);
  // Apple sends the JSON as text/javascript, so it is read as text.
  return JSON.parse(await response.text());
}

/**
 * Every app of `ids` the App Store sells in `territory`, by id: one request
 * for up to 50 apps, after this window's turn at the lookup service. An app
 * not sold there is missing from the map, which is a normal answer.
 */
export async function lookupStorefronts(
  ids: string[],
  territory: string,
  options: { signal?: AbortSignal; now?: number } = {}
): Promise<Map<string, RivalStorefront>> {
  const found = new Map<string, RivalStorefront>();
  const seenAt = options.now ?? Date.now();
  for (let start = 0; start < ids.length; start += IDS_PER_LOOKUP) {
    const chunk = ids.slice(start, start + IDS_PER_LOOKUP);
    await lookupTurn(options.signal);
    const params = new URLSearchParams({ id: chunk.join(','), country: territory.toLowerCase(), entity: 'software' });
    for (const row of rowsOf(await getJson(`${LOOKUP_URL}?${params.toString()}`, options.signal))) {
      const storefront = readStorefront(row, territory, seenAt);
      if (storefront) found.set(String(row.trackId), storefront);
    }
  }
  return found;
}

/**
 * Apps to follow, from what the user typed: an App Store link or id finds
 * that app, a Google Play link finds that app in the desktop app, and
 * anything else searches the App Store by name. Google Play is never
 * searched: its robots.txt closes search to programs.
 */
export async function findRivals(
  input: string,
  options: { territory: string; signal?: AbortSignal }
): Promise<{ candidates: RivalCandidate[]; notice: string | null }> {
  const parsed = parseStoreLink(input);
  if (!parsed) return { candidates: [], notice: null };
  if (parsed.kind === 'play') {
    if (!canReadGooglePlay()) {
      return {
        candidates: [],
        notice: 'Google Play apps can be followed in the desktop app. Here, paste an App Store link or type the name of the app',
      };
    }
    // A link can name its country (&gl=gb); otherwise the country on screen.
    const linkCountry = /[?&]gl=([a-z]{2})(?:&|#|$)/i.exec(input)?.[1]?.toUpperCase();
    const territory = linkCountry && TERRITORY_CODES.includes(linkCountry) ? linkCountry : options.territory;
    let storefront: RivalStorefront | null;
    try {
      storefront = await fetchPlayStorefront(parsed.packageName, territory, { signal: options.signal });
    } catch (error) {
      if ((error as Error)?.name === 'AbortError' || options.signal?.aborted) throw error;
      console.error('Reading the Google Play page failed', error);
      return {
        candidates: [],
        notice:
          error instanceof PlayPageUnreadable
            ? 'Growth could not read that Google Play page. Google may have changed how its pages are built'
            : 'Google Play could not be reached. Check your connection and try again',
      };
    }
    return storefront
      ? { candidates: [candidateOf(storefront, playAppId(parsed.packageName))], notice: null }
      : { candidates: [], notice: 'No Google Play app was found for that link' };
  }
  if (parsed.kind === 'apple') {
    // A link names its own country (apps.apple.com/gb/...); a bare id has none.
    const territory = /\/[a-z]{2}\/app\//i.test(input) ? parsed.country.toUpperCase() : options.territory;
    const found = await lookupStorefronts([parsed.id], territory, { signal: options.signal });
    const storefront = found.get(parsed.id);
    return storefront
      ? { candidates: [candidateOf(storefront, parsed.id)], notice: null }
      : { candidates: [], notice: 'No App Store app was found for that link' };
  }
  await lookupTurn(options.signal);
  const params = new URLSearchParams({ term: parsed.term, entity: 'software', country: options.territory.toLowerCase(), limit: '10' });
  const body = await getJson(`${SEARCH_URL}?${params.toString()}`, options.signal);
  const now = Date.now();
  const candidates = rowsOf(body)
    .map((row) => {
      const storefront = readStorefront(row, options.territory, now);
      return storefront ? candidateOf(storefront, String(row.trackId)) : null;
    })
    .filter((candidate): candidate is RivalCandidate => !!candidate);
  return { candidates, notice: candidates.length === 0 ? 'No App Store app matched that name' : null };
}

// --- comparing what an app shows -------------------------------------------------

const SIZE_SEGMENT = /\/\d+x\d+[a-z]*\.(?:png|jpe?g|webp|heic)$/i;
/** Google's image server takes the size after `=`: `=w526-h296`, `=s600-rw`. */
const GOOGLE_SIZE = /=[^/]*$/;
const PLAY_IMAGE = /^https:\/\/play-lh\.googleusercontent\.com\//;

/**
 * The picture an image address names, without the host or the size it asks
 * for: Apple hands out one screenshot from is1-ssl to is5-ssl.mzstatic.com and
 * at any size, under one path, and Google's image server at any size too.
 */
export function assetKey(url: string | null | undefined): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (parsed.hostname.endsWith('.googleusercontent.com')) return `${parsed.hostname}${parsed.pathname.replace(GOOGLE_SIZE, '')}`;
    const path = parsed.pathname.replace(SIZE_SEGMENT, '');
    return parsed.hostname.endsWith('mzstatic.com') ? path.replace(/^\/image\/thumb\//, '') : `${parsed.hostname}${path}`;
  } catch {
    return url.replace(/[?#].*$/, '').replace(SIZE_SEGMENT, '');
  }
}

/** Wider than tall, from the size the address names: Apple's `/696x392bb.jpg`, or Google Play's `=w1920-h1080`. */
export function isWideShot(url: string): boolean {
  const size = /\/(\d+)x(\d+)[a-z]*\.\w+$/i.exec(url) ?? /=w(\d+)-h(\d+)$/.exec(url);
  return !!size && Number(size[1]) > Number(size[2]);
}

/** Whether two screenshot sets are the same pictures in the same order. */
export function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((url, index) => assetKey(url) === assetKey(b[index]));
}

/** How one screenshot set became another: pictures added, pictures taken out, or the same pictures in a new order. */
export function describeSetChange(before: string[], after: string[]): { added: number; removed: number; reordered: boolean } {
  const was = new Set(before.map(assetKey));
  const now = new Set(after.map(assetKey));
  const added = Array.from(now).filter((key) => !was.has(key)).length;
  const removed = Array.from(was).filter((key) => !now.has(key)).length;
  return { added, removed, reordered: added === 0 && removed === 0 && !sameSet(before, after) };
}

/**
 * The same artwork at a smaller size, as WebP: a box of `edge` pixels.
 * Apple's image server renders any size an address asks for, and a page of
 * competitors' screenshots at the 392 pixel JPEGs the lookup hands out would
 * download several times what the screen shows. Google Play's server does
 * the same for its store images, which come full size otherwise.
 */
export function artworkAt(url: string, edge: number): string {
  if (PLAY_IMAGE.test(url)) return `${url.replace(GOOGLE_SIZE, '')}=s${edge}-rw`;
  return SIZE_SEGMENT.test(url) && url.includes('mzstatic.com') ? url.replace(SIZE_SEGMENT, `/${edge}x${edge}bb.webp`) : url;
}

function releaseTime(value: string | null): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

/** An answer about a version released before the one already kept: a stale copy from Apple's CDN. */
export function isStaleAnswer(previous: RivalStorefront, next: RivalStorefront): boolean {
  const before = releaseTime(previous.releasedAt);
  const after = releaseTime(next.releasedAt);
  return before !== null && after !== null && after < before;
}

/** A change one country showed, before changes with the same before and after are put together. */
export interface CountryChange {
  territory: string;
  kind: RivalChangeKind;
  before: string[];
  after: string[];
  notes?: string;
}

function samePrice(a: { price: number | null; priceLabel: string }, b: { price: number | null; priceLabel: string }): boolean {
  return a.price === b.price && a.priceLabel === b.priceLabel;
}

/**
 * What to keep for one app in one country after a check, and what changed.
 * The first answer for a country only sets what later checks compare with.
 */
export function diffStorefront(previous: RivalStorefront | null | undefined, next: RivalStorefront): { kept: RivalStorefront; changes: CountryChange[]; stale: boolean } {
  if (!previous) return { kept: next, changes: [], stale: false };
  if (isStaleAnswer(previous, next)) return { kept: previous, changes: [], stale: true };
  const territory = next.territory;
  const changes: CountryChange[] = [];
  // Some Google Play pages have no version. A version that shows up on a page
  // that had none, or goes away, is not a new version.
  const newVersion = !!previous.version && !!next.version && previous.version !== next.version;
  const kept: RivalStorefront = { ...next, pendingPrice: undefined };

  // An answer with no screenshots for an app that had some, on the same
  // version, is an answer with a part missing, not an app that took its
  // screenshots down: the store cannot show a version's page without them.
  // A Google Play page with no screenshot does not get here: readPlayPage
  // reports it as a page Growth cannot read.
  for (const [kind, field] of [
    ['screenshots', 'screenshots'],
    ['ipad-screenshots', 'ipadScreenshots'],
  ] as const) {
    const was = previous[field];
    const now = next[field];
    if (now.length === 0 && was.length > 0 && !newVersion) {
      kept[field] = was;
      continue;
    }
    if (!sameSet(was, now)) changes.push({ territory, kind, before: was, after: now });
  }
  if (newVersion) {
    changes.push({ territory, kind: 'version', before: [previous.version], after: [next.version], notes: next.releaseNotes || undefined });
  } else if ((releaseTime(next.releasedAt) ?? 0) > (releaseTime(previous.releasedAt) ?? Infinity)) {
    // A later update day with no new version number: a Google Play app with no version on its page.
    changes.push({ territory, kind: 'update', before: [previous.releasedAt ?? ''], after: [next.releasedAt ?? ''], notes: next.releaseNotes || undefined });
  }
  if (previous.name !== next.name) changes.push({ territory, kind: 'name', before: [previous.name], after: [next.name] });
  if (assetKey(previous.iconUrl) !== assetKey(next.iconUrl) && next.iconUrl) {
    changes.push({ territory, kind: 'icon', before: previous.iconUrl ? [previous.iconUrl] : [], after: [next.iconUrl] });
  }

  if (!samePrice(previous, next)) {
    if (previous.pendingPrice && samePrice(previous.pendingPrice, next)) {
      changes.push({ territory, kind: 'price', before: [previous.priceLabel], after: [next.priceLabel] });
    } else {
      // Seen once: keep the old price on show until the next check agrees.
      kept.price = previous.price;
      kept.priceLabel = previous.priceLabel;
      kept.currency = previous.currency;
      kept.pendingPrice = { price: next.price, priceLabel: next.priceLabel, currency: next.currency };
    }
  }
  return { kept, changes, stale: false };
}

function hash(value: string): string {
  let result = 5381;
  for (let index = 0; index < value.length; index += 1) result = ((result << 5) + result + value.charCodeAt(index)) | 0;
  return (result >>> 0).toString(36);
}

/**
 * One change per app, kind, before and after, with every country that showed
 * it: an app that swaps its screenshots everywhere is one change, not twenty.
 */
export function groupChanges(appId: string, found: CountryChange[], foundAt: number): RivalChange[] {
  const groups = new Map<string, RivalChange>();
  for (const change of found) {
    const sides = change.kind === 'screenshots' || change.kind === 'ipad-screenshots' || change.kind === 'icon'
      ? [change.before.map(assetKey), change.after.map(assetKey)]
      : [change.before, change.after];
    const signature = `${change.kind}|${JSON.stringify(sides)}`;
    const group = groups.get(signature);
    if (group) {
      group.territories.push(change.territory);
      continue;
    }
    groups.set(signature, {
      id: `${appId}:${change.kind}:${foundAt.toString(36)}:${hash(signature)}`,
      appId,
      kind: change.kind,
      foundAt,
      territories: [change.territory],
      before: change.before,
      after: change.after,
      ...(change.notes ? { notes: change.notes } : {}),
    });
  }
  return Array.from(groups.values());
}

// --- countries ------------------------------------------------------------------

/** The App Store country of the browser's own region, when it has one. */
export function localTerritory(): string | null {
  if (typeof navigator === 'undefined') return null;
  for (const language of navigator.languages ?? [navigator.language]) {
    try {
      const region = new Intl.Locale(language).maximize().region;
      if (region && TERRITORY_CODES.includes(region)) return region;
    } catch {
      // A malformed language tag names no region.
    }
  }
  return null;
}

/** The countries a new list starts with: the ones given first (the app's busiest), then the defaults. */
export function startingCountries(preferred: Array<string | null | undefined>): string[] {
  const codes = [...preferred, ...DEFAULT_RIVAL_COUNTRIES].filter(
    (code): code is string => !!code && TERRITORY_CODES.includes(code)
  );
  return Array.from(new Set(codes)).slice(0, NEW_LIST_COUNTRIES);
}
