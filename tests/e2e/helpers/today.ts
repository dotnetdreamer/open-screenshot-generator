import type { Page } from '@playwright/test';
import { generateKeyPairSync } from 'node:crypto';
import { addDays } from '@/lib/growth/dates';
import type { Counts, DayRecord, StoreReview, TerritoryRating, TimelineEvent } from '@/lib/growth/types';
import {
  SAMPLE_APP,
  sampleEvents,
  sampleListing,
  sampleRatings,
  sampleRecords,
  sampleReviews,
} from '../../fixtures/growthSample';
import type { TauriHttpRule } from '../fixtures/tauri-runtime';
import { TEST_KEY, putGrowthRows } from './growth';

/**
 * A test account with several apps, for Growth's Today screen: the sample
 * app as it is, two more App Store apps made from it at other sizes (one of
 * them new, with five weeks of numbers), a Google Play app whose numbers end
 * a few days earlier as Google's do, and an App Store app nobody refreshed
 * yet. Every number is made up and lives in the test only.
 */

export const STUDIO_APPS = {
  juniper: { id: SAMPLE_APP.id, name: SAMPLE_APP.name, bundleId: SAMPLE_APP.bundleId },
  fernleaf: { id: 'studio-fernleaf', name: 'Fernleaf Journal', bundleId: 'com.example.fernleaf' },
  tidewell: { id: 'studio-tidewell', name: 'Tidewell Budget', bundleId: 'com.example.tidewell' },
  orbit: { id: 'studio-orbit', name: 'Orbit Sketch', bundleId: 'com.example.orbit' },
  pebble: { id: 'play:com.example.pebble', name: 'Pebble Notes', bundleId: 'com.example.pebble' },
} as const;

const APP_STORE = [STUDIO_APPS.juniper, STUDIO_APPS.fernleaf, STUDIO_APPS.tidewell, STUDIO_APPS.orbit];

/** Apple's list of the account's apps; anything else Apple is asked answers 404. */
export const STUDIO_RULES: TauriHttpRule[] = [
  {
    match: '^GET https://api\\.appstoreconnect\\.apple\\.com/v1/apps\\?',
    body: JSON.stringify({
      data: APP_STORE.map((app) => ({ type: 'apps', id: app.id, attributes: { name: app.name, bundleId: app.bundleId, sku: app.id, primaryLocale: 'en-US' } })),
    }),
  },
];

const PLAY_KEY = JSON.stringify({
  type: 'service_account',
  project_id: 'pebble-play',
  private_key_id: 'e2e',
  private_key: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  client_email: 'growth@pebble-play.iam.gserviceaccount.com',
  client_id: '1',
  token_uri: 'https://oauth2.googleapis.com/token',
});

function scaled(counts: Counts, factor: number): Counts {
  const out: Counts = {};
  for (const [field, value] of Object.entries(counts) as Array<[keyof Counts, unknown]>) {
    if (field === 'proceeds') {
      out.proceeds = Object.fromEntries(Object.entries(value as Record<string, number>).map(([code, amount]) => [code, Math.round(amount * factor * 100) / 100]));
    } else {
      (out as Record<string, number>)[field] = Math.round((value as number) * factor);
    }
  }
  return out;
}

function scaleAll<T extends Record<string, Counts>>(map: T, factor: number): T {
  return Object.fromEntries(Object.entries(map).map(([key, counts]) => [key, scaled(counts, factor)])) as T;
}

/** The sample's days for another App Store app, `factor` times the size, from `since` on when given. */
function appStoreDays(appId: string, factor: number, since?: string): DayRecord[] {
  return sampleRecords()
    .filter((record) => !since || record.date >= since)
    .map((record) => ({
      ...record,
      key: `${appId}|${record.date}`,
      appId,
      territories: scaleAll(record.territories, factor),
      sources: scaleAll(record.sources as Record<string, Counts>, factor),
      devices: record.devices ? scaleAll(record.devices, factor) : undefined,
    }));
}

/** The sample's days as a Google Play app's: installs and store page visits, ending `behind` days before the sample's. */
function playDays(appId: string, factor: number, behind: number): DayRecord[] {
  const records = sampleRecords();
  const last = records[records.length - 1].date;
  return records
    .filter((record) => record.date <= addDays(last, -behind))
    .map((record) => {
      const territories: Record<string, Counts> = {};
      for (const [code, counts] of Object.entries(record.territories)) {
        territories[code] = {
          firstDownloads: Math.round((counts.firstDownloads ?? counts.units ?? 0) * factor),
          updates: Math.round((counts.updates ?? 0) * factor),
          pageViews: Math.round((counts.pageViews ?? 0) * factor),
          uniquePageViews: Math.round((counts.uniquePageViews ?? 0) * factor),
          pageDownloads: Math.round((counts.pageDownloads ?? 0) * factor),
        };
      }
      return { key: `${appId}|${record.date}`, appId, date: record.date, territories, sources: {}, feeds: { installs: Date.now(), visits: Date.now() } };
    });
}

function ratingsFor(appId: string, factor: number, shift: number): TerritoryRating[] {
  return sampleRatings().map((rating) => ({
    ...rating,
    key: `${appId}|${rating.territory}`,
    appId,
    count: Math.max(1, Math.round(rating.count * factor)),
    average: Math.min(5, Math.round((rating.average + shift) * 10) / 10),
  }));
}

function reviewFor(appId: string, id: string, rating: number, title: string, body: string, hoursAgo: number, answered = false): StoreReview {
  const created = new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
  return {
    id,
    appId,
    rating,
    title,
    body,
    nickname: 'e2e',
    createdDate: created,
    territory: appId.startsWith('play:') ? 'ZZ' : 'US',
    ...(answered ? { response: { id: `${id}-reply`, body: 'Thank you!', lastModified: created, state: 'PUBLISHED' } } : {}),
  };
}

/** A plain SVG icon as a data address, so the rows show an icon without a network. */
function icon(from: string, to: string, glyph: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="64" height="64" fill="url(#g)"/><text x="32" y="43" font-family="Helvetica,Arial" font-size="30" font-weight="700" fill="white" text-anchor="middle">${glyph}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

// In the colours each app gets on the charts (Apple lists the apps by name:
// Fernleaf, Juniper, Orbit, Tidewell, then the Google Play app), so the
// pictures from this spec read the way a real account's would.
export const STUDIO_ICONS: Record<string, string> = {
  [STUDIO_APPS.fernleaf.id]: icon('#5b9df0', '#1f5fbf', 'F'),
  [STUDIO_APPS.juniper.id]: icon('#ff9563', '#d9501f', 'J'),
  [STUDIO_APPS.orbit.id]: icon('#3ed3a0', '#118a63', 'O'),
  [STUDIO_APPS.tidewell.id]: icon('#ffc94d', '#d99000', 'T'),
  [STUDIO_APPS.pebble.id]: icon('#f39bbd', '#d6588a', 'P'),
};

function live(appId: string) {
  return { key: `app:live:${appId}`, value: { version: '1.0', releaseDate: null, screenshotUrls: [], ipadScreenshotUrls: [], storeUrl: null, iconUrl: STUDIO_ICONS[appId], checkedAt: Date.now() } };
}

/**
 * Save both keys and write every app's rows, refreshed a moment ago so no
 * refresh starts by itself. The app reads the keys once, so reload
 * (`app.goto()`) afterwards.
 */
export async function connectStudioAccount(page: Page, options: { growth?: Record<string, unknown> } = {}): Promise<void> {
  await page.evaluate(
    ({ key, play, growth }) => {
      localStorage.setItem(
        'open-screenshot-generator.store-credentials',
        JSON.stringify({
          appstore: { issuerId: '69a6de70-0000-47e3-e053-5b8c7c11a4d1', keyId: 'ABCD123456', privateKey: key },
          playstore: { serviceAccountJson: play, packageName: 'com.example.pebble' },
        })
      );
      localStorage.setItem('open-screenshot-generator.growth', JSON.stringify({ vendorNumber: '85012345', playReportsUri: 'gs://pubsite_prod_e2e/stats/installs/', ...growth }));
    },
    { key: TEST_KEY, play: PLAY_KEY, growth: options.growth ?? {} }
  );
  const now = Date.now();
  const end = sampleRecords().slice(-1)[0].date;
  const events: TimelineEvent[] = [
    ...sampleEvents(),
    {
      id: 'studio-fernleaf-release',
      appId: STUDIO_APPS.fernleaf.id,
      date: addDays(end, -4),
      kind: 'release',
      title: 'Version 3.2',
      version: '3.2',
      origin: 'auto',
      createdAt: now,
    },
  ];
  await putGrowthRows(page, {
    days: [
      ...sampleRecords(),
      ...appStoreDays(STUDIO_APPS.fernleaf.id, 0.42),
      ...appStoreDays(STUDIO_APPS.tidewell.id, 0.12, addDays(end, -34)),
      ...playDays(STUDIO_APPS.pebble.id, 0.3, 4),
    ],
    reviews: [
      ...sampleReviews(),
      reviewFor(STUDIO_APPS.fernleaf.id, 'fern-1', 5, 'My favourite journal', 'Calm, quick and pretty. The daily prompt is perfect.', 5, true),
      reviewFor(STUDIO_APPS.fernleaf.id, 'fern-2', 4, 'Lovely, one wish', 'Please add a dark mode for the editor.', 30),
      reviewFor(STUDIO_APPS.pebble.id, 'pebble-1', 2, 'Sync lost a note', 'A note from yesterday is gone after the update.', 20),
    ],
    ratings: [...sampleRatings(), ...ratingsFor(STUDIO_APPS.fernleaf.id, 0.38, 0.1), ...ratingsFor(STUDIO_APPS.tidewell.id, 0.02, -0.3)],
    events,
    listings: [sampleListing()],
    meta: [
      { key: `sync:last:${STUDIO_APPS.juniper.id}`, value: now },
      { key: `sync:last:${STUDIO_APPS.fernleaf.id}`, value: now - 2 * 3_600_000 },
      { key: `sync:last:${STUDIO_APPS.tidewell.id}`, value: now - 5 * 3_600_000 },
      { key: `sync:last:${STUDIO_APPS.pebble.id}`, value: now - 3_600_000 },
      { key: `play:app:${STUDIO_APPS.pebble.id}`, value: { name: STUDIO_APPS.pebble.name, iconUrl: STUDIO_ICONS[STUDIO_APPS.pebble.id] } },
      live(STUDIO_APPS.juniper.id),
      live(STUDIO_APPS.fernleaf.id),
      live(STUDIO_APPS.tidewell.id),
      live(STUDIO_APPS.orbit.id),
    ],
  });
}
