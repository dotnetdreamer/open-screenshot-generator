// Google Play apps for Competitors, read from the public page Google Play
// shows for each app (play.google.com/store/apps/details?id=...). Google has
// no public lookup like Apple's, and a Google Play key reads only the apps of
// the developer account it belongs to. So Growth reads the page a browser
// gets, the way open source scrapers do, and this file is the one place that
// knows how the page is built.
//
// Measured on 2026-11-14:
//
//   - The page is sent with no CORS header, so a web page cannot read it. The
//     desktop app asks through its own HTTP client (bridgeFetch), which can.
//     Google Play competitors are a desktop feature for that reason.
//   - The app's details are a JSON array in one of the page's
//     AF_initDataCallback blocks: name, developer, rating, number of ratings,
//     price, icon, screenshots, version, the day of the last update and its
//     "What's new" text. Each field is read from its place in the array
//     (FIELD). The version is there only for some apps: of the pages of nine
//     apps saved that day, five had one and four had none.
//   - When the name, the icon or the screenshots (each with its address and
//     size) are not where Growth reads them, readPlayPage throws
//     PlayPageUnreadable rather than guess, so a change to Google's pages
//     shows as a warning, not as an app with fewer or no screenshots. The
//     other details come back empty when they are missing, which a change to
//     Google's pages can cause too.
//   - gl (the country) sets the rating and the price. hl (the language) sets
//     the text and the listing a shopper there reads.
//   - The screenshots are one list for every device (phone, tablets,
//     Chromebook), and a set the developer uploaded for several devices is
//     repeated. Repeats are dropped.
//   - Six big apps fetched three times each gave the same screenshots every
//     time. That does not show that Google never shows a store listing
//     experiment to a visitor who is not signed in. If it does, a check can
//     see the other set of an app that runs one.
//   - An app that does not exist answers 404. An app not offered in a country
//     still answers there, so a 404 means the app is not on Google Play.
//   - robots.txt leaves app pages open and closes /store/search. Growth does
//     not search Google Play: a Google Play app is followed by its link.
//   - A page is about 220 KB compressed, so pages are asked for one at a time,
//     PLAY_PACE_MS apart.

import { bridgeFetch } from '@/lib/account/transport';
import { isTauri } from '@/lib/desktop';
import { pause, throwIfAborted } from './http';
import type { RivalStorefront } from './rivals';

/** Spacing between two Google Play pages. Google publishes no limit; this keeps a check at a person's pace. */
export const PLAY_PACE_MS = 2_000;

/** Whether this build can read Google Play pages: the desktop app only (no CORS header). */
export function canReadGooglePlay(): boolean {
  return isTauri();
}

/** A Google Play page that came back without the app's details where Growth reads them. */
export class PlayPageUnreadable extends Error {
  constructor(packageName: string) {
    super(`The Google Play page of ${packageName} did not have the app's details where Growth reads them`);
    this.name = 'PlayPageUnreadable';
  }
}

let nextTurnAt = 0;

/** Wait for this window's turn at Google Play: one page every PLAY_PACE_MS. */
export async function playTurn(signal?: AbortSignal): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, nextTurnAt);
  nextTurnAt = at + PLAY_PACE_MS;
  if (at > now) await pause(at - now, signal);
}

// Countries where phones mostly run in English, though the language CLDR
// names first for the region is another one.
const ENGLISH_STORE = new Set(['IN', 'PK', 'PH', 'KE']);

/**
 * The language a shopper in `territory` most likely reads Google Play in, as
 * Google's hl parameter ("de-DE", "pt-BR", "en-IN"): the region's likely
 * language from CLDR, with English where phones mostly use it.
 */
export function playLanguage(territory: string): string {
  const region = territory.toUpperCase();
  if (ENGLISH_STORE.has(region)) return `en-${region}`;
  try {
    const language = new Intl.Locale(`und-${region}`).maximize().language;
    return language && language !== 'und' ? `${language}-${region}` : 'en-US';
  } catch {
    return 'en-US';
  }
}

/** The page of an app as a shopper in `territory` sees it. */
export function playPageUrl(packageName: string, territory: string): string {
  const params = new URLSearchParams({ id: packageName, hl: playLanguage(territory), gl: territory.toUpperCase() });
  return `https://play.google.com/store/apps/details?${params.toString()}`;
}

// Where each detail sits in the app's array (data[1][2] of its block).
const FIELD = {
  name: [0, 0],
  packageName: [77, 0],
  developer: [68, 0],
  genre: [79, 0, 0, 0],
  rating: [51, 0, 1],
  ratingCount: [51, 2, 1],
  /** [price in millionths, currency, price as printed]; the printed price is empty for a free app. */
  offer: [57, 0, 0, 0, 0, 1, 0],
  icon: [95, 0, 3, 2],
  /** Entries of [_, _, [width, height], [_, _, address]]. */
  screenshots: [78, 0],
  /** Null in its place for some apps. */
  version: [140, 0, 0, 0],
  /** Seconds since 1970. */
  updated: [145, 0, 1, 0],
  whatsNew: [144, 1, 1],
};

const BLOCK = /AF_initDataCallback\(\{key: 'ds:\d+'[\s\S]*?data:([\s\S]*?), sideChannel: \{\}\}\);/g;

function at(value: unknown, path: number[]): unknown {
  let current = value;
  for (const index of path) {
    if (!Array.isArray(current)) return undefined;
    current = current[index];
  }
  return current;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** The app's array: the block whose app id is this package. Other blocks name the package too (similar apps, the developer's). */
function appArray(html: string, packageName: string): unknown[] | null {
  const quoted = JSON.stringify(packageName);
  for (const match of html.matchAll(BLOCK)) {
    const raw = match[1];
    if (!raw.includes(quoted)) continue;
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      continue;
    }
    const app = at(data, [1, 2]);
    if (Array.isArray(app) && at(app, FIELD.packageName) === packageName) return app;
  }
  return null;
}

/** Google's image server sizes a picture by what follows `=` in its address. */
const IMAGE_SIZE = /=[^/]*$/;

/**
 * The screenshots in the page's order, each once, with the picture's size in
 * the address (`=w1080-h1920`): the server sends the picture at that size,
 * and the screen reads from it whether a screenshot is wide. Null when an
 * entry has no address or no size where Growth reads them: skipping that
 * entry would report a screenshot taken out that is still there. Every entry
 * of the pages of eleven apps saved on 2026-11-14 had both.
 */
function screenshotsOf(app: unknown[]): string[] | null {
  const entries = at(app, FIELD.screenshots);
  if (!Array.isArray(entries)) return null;
  const seen = new Set<string>();
  const shots: string[] = [];
  for (const entry of entries) {
    const url = text(at(entry, [3, 2]));
    const width = count(at(entry, [2, 0]));
    const height = count(at(entry, [2, 1]));
    if (!url.startsWith('https://') || !width || !height) return null;
    const base = url.replace(IMAGE_SIZE, '');
    if (seen.has(base)) continue;
    seen.add(base);
    shots.push(`${base}=w${width}-h${height}`);
  }
  return shots;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };

/** "What's new" comes as HTML with <br> between lines. */
function plainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, name: string) => ENTITIES[name])
    .trim();
}

/**
 * One app in one country, from the HTML of its Google Play page. Throws
 * PlayPageUnreadable when the page has no app array for the package, or the
 * array has no name, no icon or no screenshot where they were, or a
 * screenshot entry without its address or size. No screenshot is read as a
 * page Growth cannot read: an empty set would otherwise keep the old
 * screenshots on screen with nothing to say why.
 */
export function readPlayPage(html: string, packageName: string, territory: string, seenAt: number): RivalStorefront {
  const app = appArray(html, packageName);
  const name = app ? text(at(app, FIELD.name)) : '';
  const iconUrl = app ? text(at(app, FIELD.icon)) : '';
  const screenshots = app ? screenshotsOf(app) : null;
  if (!app || !name || !iconUrl.startsWith('https://') || !screenshots || screenshots.length === 0) throw new PlayPageUnreadable(packageName);
  const offer = at(app, FIELD.offer);
  const micros = count(at(offer, [0]));
  const updated = count(at(app, FIELD.updated));
  return {
    territory,
    name,
    developer: text(at(app, FIELD.developer)),
    genre: text(at(app, FIELD.genre)),
    // Empty for an app whose page shows none; the day of the last update stands in for it.
    version: text(at(app, FIELD.version)),
    releasedAt: updated ? new Date(updated * 1000).toISOString() : null,
    releaseNotes: plainText(text(at(app, FIELD.whatsNew))),
    rating: count(at(app, FIELD.rating)),
    ratingCount: count(at(app, FIELD.ratingCount)),
    price: micros === null ? null : micros / 1_000_000,
    priceLabel: text(at(offer, [2])) || (micros === 0 ? 'Free' : ''),
    currency: text(at(offer, [1])) || null,
    iconUrl,
    screenshots,
    ipadScreenshots: [],
    storeUrl: playPageUrl(packageName, territory),
    seenAt,
  };
}

/**
 * An app as Google Play shows it in `territory`, after this window's turn.
 * Null when Google Play has no such app (404).
 */
export async function fetchPlayStorefront(
  packageName: string,
  territory: string,
  options: { signal?: AbortSignal; now?: number } = {}
): Promise<RivalStorefront | null> {
  await playTurn(options.signal);
  throwIfAborted(options.signal);
  const doFetch = await bridgeFetch();
  const response = await doFetch(playPageUrl(packageName, territory), { method: 'GET', cache: 'no-store' });
  throwIfAborted(options.signal);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Google Play answered HTTP ${response.status}`);
  return readPlayPage(await response.text(), packageName, territory, options.now ?? Date.now());
}
