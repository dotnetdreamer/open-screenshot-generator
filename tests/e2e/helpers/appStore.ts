import type { Page, Route } from '@playwright/test';
import type { TauriHttpRule } from '../fixtures/tauri-runtime';

/**
 * Apple's public lookup and search, as Growth's Competitors reaches them
 * (src/lib/growth/rivals.ts), answered from what a spec says each country
 * sells. The web build asks with the page's own fetch, which `page.route`
 * answers, with the CORS header Apple sends. The desktop app asks through
 * tauri-plugin-http, which the Tauri harness answers from its rules; those
 * are read on every request, so a spec can change an answer between checks.
 *
 * Google Play app pages (src/lib/growth/playPage.ts) are answered on the
 * desktop only, the one build that reads them: a page with the app's details
 * in an AF_initDataCallback block, at the places Google keeps them. A package
 * the spec did not stock gets the harness's 404.
 *
 * Screenshots and icons load as images from Apple's CDN hosts in both
 * builds, and get a 1x1 PNG. Google Play's images do too; the desktop app
 * fetches those through tauri-plugin-http (storeImages.ts).
 */

/** A row as Apple's lookup writes it. */
export interface StoreRow {
  trackId: number;
  trackName: string;
  artistName: string;
  version: string;
  currentVersionReleaseDate: string;
  releaseNotes?: string;
  averageUserRating: number;
  userRatingCount: number;
  price: number;
  formattedPrice: string;
  currency: string;
  screenshotUrls: string[];
  ipadScreenshotUrls: string[];
  artworkUrl512: string;
  trackViewUrl: string;
}

const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

/** An address on Apple's image CDN, the shape the lookup hands out. */
export function shotUrl(name: string, size = '392x696bb.png'): string {
  return `https://is1-ssl.mzstatic.com/image/thumb/PurpleSource221/v4/e2e/${name}.png/${size}`;
}

export function storeRow(row: Partial<StoreRow> & Pick<StoreRow, 'trackId' | 'trackName'>): StoreRow {
  return {
    artistName: 'E2E Games',
    version: '1.0',
    currentVersionReleaseDate: '2026-11-01T08:00:00Z',
    averageUserRating: 4.5,
    userRatingCount: 1200,
    price: 0,
    formattedPrice: 'Free',
    currency: 'USD',
    screenshotUrls: [],
    ipadScreenshotUrls: [],
    artworkUrl512: shotUrl(`icon-${row.trackId}`, '512x512bb.jpg'),
    trackViewUrl: `https://apps.apple.com/us/app/e2e/id${row.trackId}`,
    ...row,
  };
}

function answer(rows: StoreRow[]): string {
  return JSON.stringify({ resultCount: rows.length, results: rows.map((row) => ({ kind: 'software', wrapperType: 'software', ...row })) });
}

/** An app as its Google Play page shows it in one country. */
export interface PlayListing {
  packageName: string;
  name: string;
  developer: string;
  rating: number;
  ratingCount: number;
  /** Millionths of the currency: 0 for a free app. */
  priceMicros: number;
  currency: string;
  /** Empty for a free app, as Google prints it. */
  priceText: string;
  /** The last update, in seconds since 1970. */
  updated: number;
  /** Empty for an app whose page shows no version. */
  version: string;
  whatsNew: string;
  icon: string;
  screenshots: Array<{ url: string; width: number; height: number }>;
}

/** A picture on Google Play's image server, at the size the page gives it. */
export function playShot(name: string, width = 1080, height = 1920): { url: string; width: number; height: number } {
  return { url: `https://play-lh.googleusercontent.com/e2e-${name}`, width, height };
}

export function playListing(listing: Partial<PlayListing> & Pick<PlayListing, 'packageName' | 'name'>): PlayListing {
  return {
    developer: 'E2E Games',
    rating: 4.2,
    ratingCount: 12345,
    priceMicros: 0,
    currency: 'USD',
    priceText: '',
    updated: Date.parse('2026-11-06T06:32:44Z') / 1000,
    version: '',
    whatsNew: '- New Mode Added<br>- Bug Fixes',
    icon: `https://play-lh.googleusercontent.com/e2e-icon-${listing.packageName}`,
    screenshots: [],
    ...listing,
  };
}

/** The page Google Play sends for an app: the app's array at data[1][2], each detail where the page keeps it. */
export function playPage(listing: PlayListing): string {
  const app: unknown[] = new Array(155).fill(null);
  app[0] = [listing.name];
  app[51] = [[listing.rating.toFixed(1), listing.rating], null, [listing.ratingCount.toLocaleString('en-US'), listing.ratingCount]];
  app[57] = [[[[[null, [[listing.priceMicros, listing.currency, listing.priceText]]]]]]];
  app[68] = [listing.developer];
  app[77] = [listing.packageName];
  // A developer who uploads one set for the phone and the tablets gets it listed once per device.
  app[78] = [[...listing.screenshots, ...listing.screenshots].map((shot) => [null, 2, [shot.width, shot.height], [null, null, shot.url]])];
  app[79] = [[['Board', null, 'GAME_BOARD']]];
  app[95] = [[null, 2, [512, 512], [null, null, listing.icon]]];
  // As Minecraft's page has it, and Ludo King's, which shows no version.
  app[140] = listing.version ? [[[listing.version]], [[[36]], [[[26, '8.0']]]]] : [[null, []], [[[36]], [[[24, '7.0']]]]];
  app[144] = [null, [null, listing.whatsNew]];
  app[145] = [['', [listing.updated, 0]]];
  const data = [[[[]]], [null, null, app]];
  return `<!doctype html><html lang="en-US"><body><script class="ds:5" nonce="e2e">AF_initDataCallback({key: 'ds:5', hash: '9', data:${JSON.stringify(data)}, sideChannel: {}});</script></body></html>`;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export class FakeAppStore {
  /** What each country sells, by lowercase country code. */
  private countries: Record<string, StoreRow[]> = {};
  /** What a search answers, whatever the words. */
  private found: StoreRow[] = [];
  /** Google Play pages, by uppercase country code, then package. */
  private playPages: Record<string, Record<string, PlayListing>> = {};
  /** Google Play pages that answer HTTP 500, as `COUNTRY package`. */
  private playRefusals = new Set<string>();
  private held = false;
  private release: (() => void) | null = null;
  private gate: Promise<void> = Promise.resolve();
  private webRequests: string[] = [];

  constructor(
    private readonly page: Page,
    private readonly isDesktop: boolean,
    /** Rules the spec's desktop harness answers besides Apple's lookup, such as App Store Connect's. */
    private readonly otherRules: TauriHttpRule[] = []
  ) {}

  async install(): Promise<void> {
    await this.page.route(/^https:\/\/(is\d-ssl\.mzstatic\.com|play-lh\.googleusercontent\.com)\//, (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: PIXEL })
    );
    if (!this.isDesktop) await this.page.route(/^https:\/\/itunes\.apple\.com\//, (route) => this.answerWeb(route));
    await this.sync();
  }

  /** What `country` sells from now on. */
  async sell(country: string, rows: StoreRow[]): Promise<void> {
    this.countries[country.toLowerCase()] = rows;
    await this.sync();
  }

  async searchFinds(rows: StoreRow[]): Promise<void> {
    this.found = rows;
    await this.sync();
  }

  /** The Google Play pages of these apps in `country` from now on. */
  async showOnPlay(country: string, listings: PlayListing[]): Promise<void> {
    this.playPages[country.toUpperCase()] = Object.fromEntries(listings.map((listing) => [listing.packageName, listing]));
    for (const listing of listings) this.playRefusals.delete(`${country.toUpperCase()} ${listing.packageName}`);
    await this.sync();
  }

  /** The Google Play page of `packageName` in `country` answers HTTP 500 until `showOnPlay` gives that country the app again. */
  async refuseOnPlay(country: string, packageName: string): Promise<void> {
    this.playRefusals.add(`${country.toUpperCase()} ${packageName}`);
    await this.sync();
  }

  /** Every Google Play page the desktop app asked for, as URLs. */
  async playRequests(): Promise<URL[]> {
    const all = await this.page.evaluate(() =>
      (window as unknown as { __E2E_TAURI__: { httpRequests: Array<{ url: string }> } }).__E2E_TAURI__.httpRequests.map((request) => request.url)
    );
    return all.filter((url) => url.startsWith('https://play.google.com/')).map((url) => new URL(url));
  }

  /** Keep every lookup answer and Google Play page until `releaseLookups`, to do something while a check waits on the store. */
  async holdLookups(): Promise<void> {
    this.held = true;
    this.gate = new Promise((resolve) => (this.release = resolve));
    await this.sync();
  }

  async releaseLookups(): Promise<void> {
    this.held = false;
    await this.sync();
    this.release?.();
    if (this.isDesktop) await this.page.evaluate(() => (window as unknown as { __E2E_TAURI__: { releaseHttp(): number } }).__E2E_TAURI__.releaseHttp());
  }

  /** Every lookup and search the app sent, as URLs. */
  async requests(): Promise<URL[]> {
    if (!this.isDesktop) return this.webRequests.map((url) => new URL(url));
    const all = await this.page.evaluate(() =>
      (window as unknown as { __E2E_TAURI__: { httpRequests: Array<{ url: string }> } }).__E2E_TAURI__.httpRequests.map((request) => request.url)
    );
    return all.filter((url) => url.startsWith('https://itunes.apple.com/')).map((url) => new URL(url));
  }

  private rowsFor(url: URL): StoreRow[] {
    if (url.pathname === '/search') return this.found;
    const ids = (url.searchParams.get('id') ?? '').split(',');
    return (this.countries[url.searchParams.get('country') ?? ''] ?? []).filter((row) => ids.includes(String(row.trackId)));
  }

  private async answerWeb(route: Route): Promise<void> {
    const url = new URL(route.request().url());
    this.webRequests.push(url.toString());
    if (url.pathname === '/lookup' && this.held) await this.gate;
    await route.fulfill({
      status: 200,
      headers: { 'access-control-allow-origin': '*', 'content-type': 'text/javascript; charset=utf-8' },
      body: answer(this.rowsFor(url)),
    });
  }

  /** The desktop harness's rules: one per country, then the search, Google Play's pages and images, then the spec's own. */
  private async sync(): Promise<void> {
    if (!this.isDesktop) return;
    const play: TauriHttpRule[] = Object.entries(this.playPages).flatMap(([country, listings]) =>
      Object.values(listings).map((listing) =>
        this.playRefusals.has(`${country} ${listing.packageName}`)
          ? { match: `^GET https://play\\.google\\.com/store/apps/details\\?id=${escape(listing.packageName)}&hl=[^&]+&gl=${country}$`, status: 500, body: '' }
          : {
              match: `^GET https://play\\.google\\.com/store/apps/details\\?id=${escape(listing.packageName)}&hl=[^&]+&gl=${country}$`,
              headers: { 'content-type': 'text/html; charset=utf-8' },
              body: playPage(listing),
              hold: this.held,
            }
      )
    );
    const rules: TauriHttpRule[] = [
      ...play,
      { match: '^GET https://play-lh\\.googleusercontent\\.com/', headers: { 'content-type': 'image/png' }, bodyBase64: PIXEL.toString('base64') },
      ...Object.entries(this.countries).map(([country, rows]) => ({
        // Every app the country sells: the app takes the ones it asked for.
        match: `^GET https://itunes\\.apple\\.com/lookup\\?id=[^&]*&country=${escape(country)}&`,
        headers: { 'content-type': 'text/javascript; charset=utf-8' },
        body: answer(rows),
        hold: this.held,
      })),
      // A country the spec did not stock sells nothing.
      { match: '^GET https://itunes\\.apple\\.com/lookup\\?', headers: { 'content-type': 'text/javascript; charset=utf-8' }, body: answer([]), hold: this.held },
      { match: '^GET https://itunes\\.apple\\.com/search\\?', headers: { 'content-type': 'text/javascript; charset=utf-8' }, body: answer(this.found) },
      ...this.otherRules,
    ];
    await this.page.evaluate((next) => {
      (window as unknown as { __E2E_TAURI__: { config: { http: unknown[] } } }).__E2E_TAURI__.config.http = next;
    }, rules);
  }
}
