// Growth on Google Play: the monthly report files (read as Google writes
// them, UTF-16 with a byte order mark and Windows line ends, with the headers
// seen in real buckets in 2026), the Reviews API's shape, the client that
// reads the store page through an edit it never commits, and what the
// metrics, the screenshot check, the store page checks and the ratings make
// of a Google Play app.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import {
  fillMonthDays,
  parseCsv,
  parseInstallsReport,
  parseRatingsReport,
  parseReviewsReport,
  parseStorePerformanceByCountry,
  parseStorePerformanceBySource,
  playReportText,
  playSourceType,
  reportFile,
  reportPrefix,
} from '@/lib/growth/playReports';
import {
  MAX_PLAY_REPLY_LENGTH,
  applyPlayListingChanges,
  bucketFromUri,
  fetchPlayListing,
  readPlayReview,
  replyToPlayReview,
  splitReviewText,
} from '@/lib/growth/play';
import { listPlayLanguages } from '@/lib/publish/googlePlay';
import { mergeFeed } from '@/lib/growth/records';
import { covers, feedStarts, indexRecords, metricSpec, metricValue, storeMetrics, totalsFor } from '@/lib/growth/metrics';
import { eventImpact, liveDateFor } from '@/lib/growth/impact';
import { checkListing } from '@/lib/growth/listingChecks';
import { listingFieldsFor, listingLimit } from '@/lib/growth/listingFields';
import { ratingSummary } from '@/lib/growth/ratings';
import { languageCovers, listingLanguageName } from '@/lib/growth/territories';
import { packageOf, playAppId, storeOf } from '@/lib/growth/stores';
import { dayRange } from '@/lib/growth/dates';
import type { DayRecord, ListingSnapshot, TerritoryRating, TimelineEvent } from '@/lib/growth/types';
import type { FeedBatch } from '@/lib/growth/records';

const PACKAGE = 'com.pebble_notes.app';
const APP = playAppId(PACKAGE);

/** A report file as Google writes it: UTF-16LE with a byte order mark, CRLF line ends. */
function utf16(rows: string[][]): Uint8Array {
  const text = rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
  const body = Buffer.from(text, 'utf16le');
  return new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xfe]), body]));
}

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function csv(rows: string[][]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

test('Google Play report files are read from UTF-16 with a byte order mark, and from gzip', async () => {
  const bytes = utf16([['Date', 'Package name'], ['2026-11-01', PACKAGE]]);
  const text = await playReportText(bytes);
  assert.equal(text.charCodeAt(0), 'D'.charCodeAt(0), 'the byte order mark is gone');
  assert.deepEqual(parseCsv(text).rows, [['2026-11-01', PACKAGE]]);
  assert.equal(await playReportText(new Uint8Array(gzipSync(Buffer.from(bytes)))), text, 'a gzip file is unpacked first');
  assert.equal(await playReportText(new Uint8Array(Buffer.from('Date\r\n2026-11-01\r\n', 'utf8'))), 'Date\r\n2026-11-01\r\n');
});

test('a quoted review keeps its commas, quotes and line breaks', () => {
  const { header, rows } = parseCsv('Star Rating,Review Text\r\n5,"Great, ""really"" great\r\nSecond line"\r\n1,Bad\r\n');
  assert.deepEqual(header, ['Star Rating', 'Review Text']);
  assert.deepEqual(rows, [['5', 'Great, "really" great\r\nSecond line'], ['1', 'Bad']]);
});

test('a Play report file is known by its name, package names with underscores included', () => {
  assert.deepEqual(reportFile(`stats/installs/installs_${PACKAGE}_202611_country.csv`, PACKAGE), { kind: 'installs', month: '202611' });
  assert.deepEqual(reportFile(`stats/store_performance/store_performance_${PACKAGE}_202610_traffic_source.csv`, PACKAGE), {
    kind: 'visits-source',
    month: '202610',
  });
  assert.deepEqual(reportFile(`stats/ratings/ratings_${PACKAGE}_202611_overview.csv`, PACKAGE), { kind: 'ratings-overview', month: '202611' });
  assert.deepEqual(reportFile(`reviews/reviews_${PACKAGE}_202611.csv`, PACKAGE), { kind: 'reviews', month: '202611' });
  // Another breakdown, and another app whose package starts the same way.
  assert.equal(reportFile(`stats/installs/installs_${PACKAGE}_202611_device.csv`, PACKAGE), null);
  assert.equal(reportFile(`stats/installs/installs_${PACKAGE}_pro_202611_country.csv`, PACKAGE), null);
  assert.equal(reportPrefix('visits-country', PACKAGE), `stats/store_performance/store_performance_${PACKAGE}_`);
});

const INSTALLS_HEADER = [
  'Date', 'Package name', 'Country', 'Daily Device Installs', 'Daily Device Uninstalls', 'Daily Device Upgrades', 'Total User Installs',
  'Daily User Installs', 'Daily User Uninstalls', 'Active Device Installs', 'Install events', 'Update events', 'Uninstall events',
];

test('installs by country become new downloads and updates, with the Other row kept apart', async () => {
  const text = await playReportText(
    utf16([
      INSTALLS_HEADER,
      ['2026-11-01', PACKAGE, 'US', '14', '0', '0', '0', '12', '3', '900', '15', '40', '4'],
      ['2026-11-01', PACKAGE, 'DE', '6', '0', '0', '0', '5', '1', '300', '6', '11', '1'],
      ['2026-11-01', PACKAGE, 'Other', '2', '0', '0', '0', '2', '0', '30', '2', '3', '0'],
      ['2026-11-02', PACKAGE, 'US', '9', '0', '0', '0', '8', '2', '905', '9', '38', '2'],
    ])
  );
  const batch = parseInstallsReport(text);
  assert.deepEqual(batch.get('2026-11-01')?.territories.US, { firstDownloads: 12, updates: 40 }, 'new users, not devices, and update events');
  assert.equal(batch.get('2026-11-01')?.territories.ZZ?.firstDownloads, 2, 'Google groups small countries as Other');
  assert.equal(batch.get('2026-11-02')?.territories.US?.firstDownloads, 8);
  assert.deepEqual(batch.get('2026-11-01')?.sources, {}, 'installs have no source');
});

test('store performance gives page visits and the downloads from them, by country and by source', async () => {
  const byCountry = parseStorePerformanceByCountry(
    await playReportText(
      utf16([
        ['Date', 'Package name', 'Country / region', 'Store listing acquisitions', 'Store listing visitors', 'Store listing conversion rate'],
        ['2026-11-01', PACKAGE, 'US', '30', '100', '0.29999999999999999'],
        ['2026-11-01', PACKAGE, 'JP', '4', '50', '0.08'],
      ])
    )
  );
  assert.deepEqual(byCountry.get('2026-11-01')?.territories.US, { pageViews: 100, uniquePageViews: 100, pageDownloads: 30 });
  assert.equal(byCountry.get('2026-11-01')?.territories.JP?.pageDownloads, 4);

  const bySource = parseStorePerformanceBySource(
    await playReportText(
      utf16([
        ['Date', 'Package name', 'Traffic source', 'Search term', 'UTM source', 'UTM campaign', 'Store listing acquisitions', 'Store listing visitors', 'Store listing conversion rate'],
        ['2026-11-01', PACKAGE, 'Google Play search', 'notes app', 'No UTM source specified', 'No UTM campaign specified', '20', '60', '0.33'],
        ['2026-11-01', PACKAGE, 'Google Play search', 'Other', 'No UTM source specified', 'No UTM campaign specified', '5', '20', '0.25'],
        ['2026-11-01', PACKAGE, 'Google Play explore', 'No search terms specified', 'No UTM source specified', 'No UTM campaign specified', '6', '50', '0.12'],
        ['2026-11-01', PACKAGE, 'Ads and referrals', 'No search terms specified', 'newsletter', 'launch', '3', '20', '0.15'],
      ])
    )
  );
  const day = bySource.get('2026-11-01');
  assert.deepEqual(day?.sources.search, { pageViews: 80, uniquePageViews: 80, pageDownloads: 25 }, 'one row per search term, added up');
  assert.equal(day?.sources.browse?.pageDownloads, 6);
  assert.equal(day?.sources['web-referrer']?.pageViews, 20);
  assert.equal(playSourceType('Third-party referrals'), 'web-referrer');
  assert.equal(playSourceType('Other'), 'unavailable');
});

test('the newest total average rating wins, and days without ratings are skipped', async () => {
  const overview = parseRatingsReport(
    await playReportText(
      utf16([
        ['Date', 'Package Name', 'Daily Average Rating', 'Total Average Rating'],
        ['2026-11-03', PACKAGE, '4.00', '4.31'],
        ['2026-11-01', PACKAGE, '5.00', '4.29'],
        ['2026-11-04', PACKAGE, '0.0', '0.0'],
      ])
    ),
    APP,
    1
  );
  assert.deepEqual(overview.map((rating) => [rating.territory, rating.average, rating.count]), [['ZZ', 4.31, 0]]);
  const byCountry = parseRatingsReport(
    csv([
      ['Date', 'Package Name', 'Country', 'Daily Average Rating', 'Total Average Rating'],
      ['2026-11-02', PACKAGE, 'US', '4.5', '4.4'],
      ['2026-11-02', PACKAGE, 'DE', 'NA', '3.9'],
    ]),
    APP,
    1
  );
  assert.deepEqual(byCountry.map((rating) => rating.territory).sort(), ['DE', 'US']);
});

const REVIEWS_HEADER = [
  'Package Name', 'App Version Code', 'App Version Name', 'Reviewer Language', 'Device', 'Review Submit Date and Time',
  'Review Submit Millis Since Epoch', 'Review Last Update Date and Time', 'Review Last Update Millis Since Epoch', 'Star Rating',
  'Review Title', 'Review Text', 'Developer Reply Date and Time', 'Developer Reply Millis Since Epoch', 'Developer Reply Text', 'Review Link',
];

test('the monthly review file keeps written reviews with their replies and drops ratings without text', async () => {
  const link = (id: string) => `http://play.google.com/console/developers/123/app/456/user-feedback/review-details?reviewId=${id}&corpus=PUBLISHED_REVIEWS`;
  const reviews = parseReviewsReport(
    await playReportText(
      utf16([
        REVIEWS_HEADER,
        [PACKAGE, '31', '3.1', 'de', 'pixel8', '2026-11-02T09:00:00Z', '1793610000000', '2026-11-02T10:00:00Z', '1793613600000', '2', '', 'Stürzt ab,\nseit dem Update', '2026-11-03T08:00:00Z', '1793696400000', 'Danke, 3.2 behebt das.', link('gp:AOqpTOE1')],
        [PACKAGE, '31', '3.1', 'en', 'pixel8', '2026-11-02T11:00:00Z', '1793617200000', '2026-11-02T11:00:00Z', '1793617200000', '5', '', '', '', '', '', ''],
      ])
    ),
    APP
  );
  assert.equal(reviews.length, 1, 'a star rating without text is not a written review');
  const [review] = reviews;
  assert.equal(review.id, 'gp:AOqpTOE1', 'the id is the one the Reviews API uses, from the link');
  assert.equal(review.body, 'Stürzt ab,\nseit dem Update');
  assert.equal(review.language, 'de');
  assert.equal(review.appVersion, '3.1');
  assert.equal(review.territory, 'ZZ', 'Google Play does not say where the reviewer is');
  assert.equal(review.createdDate, new Date(1793613600000).toISOString());
  assert.equal(review.response?.body, 'Danke, 3.2 behebt das.');
});

test('a Reviews API review splits its title from its body and keeps the reply', () => {
  assert.deepEqual(splitReviewText('Lost my notes\tThe sync deleted a week.'), { title: 'Lost my notes', body: 'The sync deleted a week.' });
  assert.deepEqual(splitReviewText('Just a body'), { title: '', body: 'Just a body' });
  const review = readPlayReview(APP, {
    reviewId: 'gp:1',
    authorName: 'Kai',
    comments: [
      { userComment: { text: 'Crashes\tOn start', starRating: 1, lastModified: { seconds: '1793610000' }, reviewerLanguage: 'en_GB', appVersionName: '3.1' } },
      { developerComment: { text: 'Fixed in 3.2', lastModified: { seconds: '1793696400' } } },
    ],
  });
  assert.equal(review?.title, 'Crashes');
  assert.equal(review?.language, 'en-GB');
  assert.equal(review?.createdDate, '2026-11-02T09:00:00.000Z');
  assert.deepEqual(review?.response, { id: 'gp:1', body: 'Fixed in 3.2', lastModified: '2026-11-03T09:00:00.000Z', state: 'PUBLISHED' });
  assert.equal(readPlayReview(APP, { reviewId: 'gp:2', comments: [] }), null);
});

test('the Cloud Storage URI gives the bucket name', () => {
  assert.equal(bucketFromUri('gs://pubsite_prod_rev_01234567890987654321'), 'pubsite_prod_rev_01234567890987654321');
  assert.equal(bucketFromUri('gs://pubsite_prod_rev_01234567890987654321/stats/installs/'), 'pubsite_prod_rev_01234567890987654321');
  assert.equal(bucketFromUri(' pubsite_prod_0123456789 '), 'pubsite_prod_0123456789');
  assert.equal(bucketFromUri(''), null);
  assert.equal(bucketFromUri('not a bucket!'), null);
});

test('a Google Play app id carries its package, and its store', () => {
  assert.equal(APP, 'play:com.pebble_notes.app');
  assert.equal(packageOf(APP), PACKAGE);
  assert.equal(storeOf(APP), 'playstore');
  assert.equal(storeOf('1111111111'), 'appstore');
  assert.equal(packageOf('1111111111'), null);
});

/** Day records of a Google Play app: visits every day, installs every day. */
function playRecords(days: string[], visitors: (day: string) => number, acquisitions: (day: string) => number, installs = 10): DayRecord[] {
  return days.map((date) => {
    const withVisits = mergeFeed(undefined, APP, date, 'visits', {
      territories: { US: { pageViews: visitors(date), uniquePageViews: visitors(date), pageDownloads: acquisitions(date) } },
      sources: { search: { pageViews: visitors(date), uniquePageViews: visitors(date), pageDownloads: acquisitions(date) } },
      devices: {},
    }, 1);
    return mergeFeed(withVisits, APP, date, 'installs', { territories: { US: { firstDownloads: installs, updates: 3 } }, sources: {}, devices: {} }, 1);
  });
}

test("a Google Play app's numbers: page visits, the download rate from them, new downloads and updates", () => {
  const days = dayRange('2026-10-01', '2026-10-28');
  const records = playRecords(days, () => 100, () => 20);
  const byDate = indexRecords(records);
  const totals = totalsFor(byDate, { from: '2026-10-01', to: '2026-10-28' });
  assert.equal(metricValue(totals, 'pageViews'), 2800);
  assert.equal(metricValue(totals, 'pageConversion'), 0.2);
  assert.equal(metricValue(totals, 'downloads'), 280);
  assert.equal(metricValue(totals, 'updates'), 84);
  assert.equal(metricValue(totals, 'impressions'), null, 'Google Play sends no times seen');
  assert.equal(metricValue(totals, 'conversion'), null);
  assert.equal(metricValue(totals, 'proceeds'), null);
  // A source filter reads the visits only: installs have no source.
  const search = totalsFor(byDate, { from: '2026-10-01', to: '2026-10-28' }, { source: 'search' });
  assert.equal(search.pageDownloads, 560);
  assert.equal(metricValue(search, 'downloads'), null);

  assert.deepEqual(storeMetrics('playstore'), ['pageViews', 'pageConversion', 'downloads', 'updates']);
  assert.equal(metricSpec('pageConversion', 'playstore').label, 'Download rate');
  assert.equal(metricSpec('pageConversion', 'appstore').label, 'Page download rate');
  assert.match(metricSpec('pageViews', 'playstore').hint, /Store listing visitors/);

  const starts = feedStarts(records);
  assert.equal(starts.visits, '2026-10-01');
  assert.equal(starts.installs, '2026-10-01');
  assert.equal(covers(starts, 'pageConversion', { from: '2026-10-01', to: '2026-10-14' }), true);
  assert.equal(covers(starts, 'downloads', { from: '2026-09-20', to: '2026-10-14' }), false);
  assert.equal(covers(starts, 'impressions', { from: '2026-10-01', to: '2026-10-14' }), false);
});

function shots(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id: 'shots:play',
    appId: APP,
    date: '2026-10-15',
    kind: 'screenshots',
    title: 'New screenshots uploaded',
    origin: 'publish',
    createdAt: 1,
    ...overrides,
  };
}

test('new screenshots on Google Play are measured by the download rate from page visits, from the upload day', () => {
  const days = dayRange('2026-09-25', '2026-10-31');
  // 10% of visitors installed before the upload, 14% after.
  const records = playRecords(days, () => 400, (day) => (day > '2026-10-15' ? 56 : 40));
  const event = shots();
  const impact = eventImpact(indexRecords(records), event, { latest: '2026-10-31', events: [event] });
  assert.equal(impact.liveDate, '2026-10-15', 'no version to wait for');
  assert.equal(impact.measure, 'pageConversion');
  assert.equal(impact.beforeRate, 0.1);
  assert.equal(impact.afterRate, 0.14);
  assert.equal(impact.verdict, 'better');
});

test('a change Google Play holds for review is not live until the user sets the day', () => {
  const held = shots({ waitsForReview: true });
  assert.equal(liveDateFor(held, [held]), null);
  const days = dayRange('2026-09-25', '2026-10-31');
  const impact = eventImpact(indexRecords(playRecords(days, () => 400, () => 40)), held, { latest: '2026-10-31', events: [held] });
  assert.equal(impact.verdict, 'not-live');
  assert.equal(impact.measure, 'pageConversion');
  const live = { ...held, liveDate: '2026-10-20' };
  assert.equal(liveDateFor(live, [live]), '2026-10-20', 'the day the user set wins');
  assert.equal(liveDateFor(shots({ liveDate: '2026-10-18' }), []), '2026-10-18');
});

function playListing(locales: Array<Partial<ListingSnapshot['locales'][number]> & { locale: string }>): ListingSnapshot {
  return {
    appId: APP,
    versionId: '',
    versionString: '',
    state: 'PLAY',
    platform: 'ANDROID',
    editable: true,
    appInfoEditable: true,
    primaryLocale: locales[0].locale,
    locales: locales.map((entry) => ({
      name: '',
      subtitle: '',
      keywords: '',
      promotionalText: '',
      description: '',
      whatsNew: '',
      ...entry,
    })),
    fetchedAt: 1,
  };
}

test('Google Play store page checks: its limits, its title rules, and nothing about keywords', () => {
  assert.deepEqual(listingFieldsFor(APP), ['name', 'subtitle', 'description']);
  assert.equal(listingLimit(APP, 'subtitle'), 80);
  assert.equal(listingLimit('1111111111', 'subtitle'), 30);
  const long = 'Pebble keeps your notes in one calm place. '.repeat(10);
  const issues = checkListing(
    playListing([
      { locale: 'en-US', name: 'Best Notes App', subtitle: 'A calm place for your notes, lists and ideas, on every device you own, always', description: long },
      { locale: 'de-DE', name: 'Pebble Notizen', subtitle: '', description: long },
    ])
  );
  const ids = issues.map((issue) => issue.id);
  assert.ok(ids.includes('en-US:name:play-title-rules'), 'a title with "best" breaks Google Play\'s rules');
  assert.ok(ids.includes('de-DE:subtitle:empty'), 'every language needs a short description');
  assert.ok(!ids.some((id) => id.includes(':keywords:') || id.includes(':promotionalText:')), 'Google Play has no keywords or promotional text');
  assert.ok(!ids.includes('en-US:subtitle:too-long'), 'a short description of 78 characters is within Google Play\'s 80');
  assert.ok(ids.includes('de-DE:description:untranslated'), 'the German page copies the English description');
  const brand = checkListing(playListing([{ locale: 'en-US', name: 'New York Notes', subtitle: 'Notes for the city that never sleeps, kept calm', description: long }]));
  assert.ok(!brand.some((issue) => issue.id.endsWith(':play-title-rules')), '"New" starts brand names too often to flag');
});

test("Google Play's language codes compare with the App Store's and have readable names", () => {
  assert.equal(languageCovers('zh-CN', 'zh-Hans'), true);
  assert.equal(languageCovers('zh-TW', 'zh-Hans'), false);
  assert.equal(languageCovers('iw-IL', 'he'), true);
  assert.equal(languageCovers('ja-JP', 'ja'), true);
  assert.equal(languageCovers('es-419', 'es-MX'), true);
  assert.equal(listingLanguageName('es-419'), 'Latin American Spanish');
  assert.equal(listingLanguageName('zh-CN'), 'Simplified Chinese');
  assert.equal(listingLanguageName('en-GB'), 'British English');
});

test('ratings: counted countries on the App Store, the whole-app average on Google Play', () => {
  const rating = (territory: string, average: number, count: number): TerritoryRating => ({
    key: `x|${territory}`,
    appId: 'x',
    territory,
    average,
    count,
    checkedAt: 1,
  });
  assert.deepEqual(ratingSummary([rating('US', 4, 300), rating('DE', 5, 100)]), { average: 4.25, count: 400, countries: 2 });
  assert.deepEqual(ratingSummary([rating('ZZ', 4.31, 0), rating('US', 4.4, 0), rating('DE', 3.9, 0)]), { average: 4.31, count: null, countries: 2 });
  assert.deepEqual(ratingSummary([]), { average: null, count: null, countries: 0 });
});

// --- the client, against a fake Google -----------------------------------------------

const PRIVATE_KEY = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

function credentialsFor(email: string) {
  return {
    packageName: PACKAGE,
    serviceAccountJson: JSON.stringify({ type: 'service_account', client_email: email, private_key: PRIVATE_KEY, token_uri: 'https://oauth2.googleapis.com/token' }),
  };
}

interface Call {
  method: string;
  url: string;
  body: string | null;
}

/** window.fetch answering like Google: a token, then whatever `route` says. */
function fakeGoogle(route: (call: Call) => Response | Promise<Response>): { calls: Call[]; restore: () => void } {
  const calls: Call[] = [];
  const root = globalThis as unknown as { window?: unknown };
  root.window = {
    fetch: async (url: string, init: { method?: string; body?: string } = {}) => {
      const call = { method: init.method ?? 'GET', url, body: typeof init.body === 'string' ? init.body : null };
      if (url === 'https://oauth2.googleapis.com/token') {
        assert.match(call.body ?? '', /grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer/);
        return new Response(JSON.stringify({ access_token: 'token-1', expires_in: 3600 }), { status: 200 });
      }
      calls.push(call);
      return route(call);
    },
  };
  return { calls, restore: () => delete root.window };
}

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

test('the store page is read through an edit that is deleted again, never committed', async () => {
  const google = fakeGoogle(({ method, url }) => {
    const path = url.replace(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}`, '');
    if (method === 'POST' && path === '/edits') return json({ id: 'edit-1' });
    if (path === '/edits/edit-1/details') return json({ defaultLanguage: 'en-US' });
    if (path === '/edits/edit-1/listings') {
      return json({
        listings: [
          { language: 'de-DE', title: 'Pebble Notizen', shortDescription: 'Ruhige Notizen', fullDescription: 'Lang' },
          { language: 'en-US', title: 'Pebble Notes', shortDescription: 'Calm notes', fullDescription: 'Long' },
        ],
      });
    }
    if (path === '/edits/edit-1/listings/en-US/phoneScreenshots') return json({ images: [{ id: '1', url: 'https://lh3.example/1' }, { id: '2', url: 'https://lh3.example/2' }] });
    if (path === '/edits/edit-1/listings/de-DE/phoneScreenshots') return json({});
    if (path === '/edits/edit-1/listings/en-US/icon') return json({ images: [{ id: 'i', url: 'https://lh3.example/icon' }] });
    if (method === 'DELETE' && path === '/edits/edit-1') return json({});
    return json({ error: { message: `No answer for ${method} ${path}` } }, 404);
  });
  try {
    const result = await fetchPlayListing(credentialsFor('reader@example.iam.gserviceaccount.com'), APP);
    assert.ok(result);
    assert.equal(result.listing.primaryLocale, 'en-US');
    assert.deepEqual(result.listing.locales.map((entry) => entry.locale), ['en-US', 'de-DE'], 'the main language first');
    assert.equal(result.listing.locales[0].name, 'Pebble Notes');
    assert.equal(result.listing.locales[0].subtitle, 'Calm notes', 'the short description sits in subtitle');
    assert.deepEqual(result.listing.locales[1].screenshotCounts, { phoneScreenshots: 0 });
    assert.deepEqual(result.images.screenshotUrls, ['https://lh3.example/1', 'https://lh3.example/2']);
    assert.equal(result.images.iconUrl, 'https://lh3.example/icon');
    assert.equal(result.images.storeUrl, `https://play.google.com/store/apps/details?id=${PACKAGE}`);
    assert.equal(google.calls.at(-1)?.method, 'DELETE', 'the edit is deleted at the end');
    assert.ok(!google.calls.some((call) => call.url.includes(':commit')), 'nothing is committed');
  } finally {
    google.restore();
  }
});

test('Growth and the upload take turns with edits, since a new edit cancels the open one', async () => {
  let open = 0;
  let most = 0;
  let next = 0;
  const google = fakeGoogle(async ({ method, url }) => {
    if (method === 'POST' && url.endsWith('/edits')) {
      open += 1;
      most = Math.max(most, open);
      next += 1;
      return json({ id: `edit-${next}` });
    }
    if (method === 'DELETE') {
      open -= 1;
      return json({});
    }
    // Slow answers, so two reads would overlap if nothing kept them apart.
    await new Promise((resolve) => setTimeout(resolve, 15));
    if (url.endsWith('/details')) return json({ defaultLanguage: 'en-US' });
    if (url.endsWith('/listings')) return json({ listings: [{ language: 'en-US', title: 'Pebble Notes' }] });
    return json({ images: [] });
  });
  try {
    const credentials = credentialsFor('turns@example.iam.gserviceaccount.com');
    await Promise.all([fetchPlayListing(credentials, APP), listPlayLanguages(credentials), fetchPlayListing(credentials, APP)]);
    assert.equal(most, 1, 'never two edits open at once');
    assert.equal(open, 0);
  } finally {
    google.restore();
  }
});

test('a store page change is one commit, and a refused change leaves no edit behind', async () => {
  const listing = playListing([
    { locale: 'en-US', name: 'Pebble Notes', subtitle: 'Calm notes', description: 'Long' },
    { locale: 'de-DE', name: 'Pebble Notizen', subtitle: 'Ruhige Notizen', description: 'Lang' },
  ]);
  let refuse = false;
  const google = fakeGoogle(({ method, url }) => {
    if (method === 'POST' && url.endsWith('/edits')) return json({ id: 'edit-9' });
    if (method === 'PATCH') return refuse ? json({ error: { message: 'Title is too long' } }, 400) : json({});
    if (url.endsWith(':validate')) return json({});
    if (url.endsWith(':commit')) return json({ error: { message: 'Changes cannot be sent for review automatically. Please set the query parameter changesNotSentForReview to true.' } }, 400);
    if (url.endsWith(':commit?changesNotSentForReview=true')) return json({ id: 'edit-9' });
    if (method === 'DELETE') return json({});
    return json({}, 404);
  });
  try {
    const credentials = credentialsFor('writer@example.iam.gserviceaccount.com');
    const result = await applyPlayListingChanges(credentials, listing, [
      { locale: 'en-US', field: 'subtitle', after: 'Calm notes and lists' },
      { locale: 'de-DE', field: 'name', after: 'Pebble Notizen und Listen' },
    ]);
    assert.deepEqual(result.applied, ['en-US:subtitle', 'de-DE:name']);
    assert.equal(result.sentForReview, false, 'Play would only take the change without sending it for review');
    const patches = google.calls.filter((call) => call.method === 'PATCH');
    assert.deepEqual(patches.map((call) => [call.url.split('/listings/')[1], JSON.parse(call.body ?? '{}')]), [
      ['en-US', { shortDescription: 'Calm notes and lists' }],
      ['de-DE', { title: 'Pebble Notizen und Listen' }],
    ]);
    assert.ok(!google.calls.some((call) => call.method === 'DELETE'), 'a committed edit is not deleted');

    refuse = true;
    google.calls.length = 0;
    await assert.rejects(applyPlayListingChanges(credentials, listing, [{ locale: 'en-US', field: 'name', after: 'x'.repeat(31) }]), /Title is too long/);
    assert.equal(google.calls.at(-1)?.method, 'DELETE', 'the refused edit is deleted');
    assert.ok(!google.calls.some((call) => call.url.includes(':commit')));
    await assert.rejects(applyPlayListingChanges(credentials, listing, [{ locale: 'fr-FR', field: 'name', after: 'Pebble' }]), /not a language/);
  } finally {
    google.restore();
  }
});

test('a reply longer than Google Play takes is refused before it is sent', async () => {
  const google = fakeGoogle(({ url, body }) => {
    assert.match(url, /\/reviews\/gp%3A1:reply$/);
    return json({ result: { replyText: JSON.parse(body ?? '{}').replyText, lastEdited: { seconds: '1793696400' } } });
  });
  try {
    const credentials = credentialsFor('replies@example.iam.gserviceaccount.com');
    await assert.rejects(replyToPlayReview(credentials, 'gp:1', 'x'.repeat(MAX_PLAY_REPLY_LENGTH + 1)), /up to 350 characters/);
    assert.equal(google.calls.length, 0);
    const response = await replyToPlayReview(credentials, 'gp:1', ' Thanks, fixed in 3.2. ');
    assert.deepEqual(response, { id: 'gp:1', body: 'Thanks, fixed in 3.2.', lastModified: '2026-11-03T09:00:00.000Z', state: 'PUBLISHED' });
  } finally {
    google.restore();
  }
});

test('a month of numbers has a zero for each day without rows, up to the newest day in the file', () => {
  const batch: FeedBatch = new Map([['2026-11-03', { territories: { US: { firstDownloads: 2 } }, sources: {}, devices: {} }]]);
  const filled = fillMonthDays(batch);
  assert.deepEqual(Array.from(filled.keys()).sort(), ['2026-11-01', '2026-11-02', '2026-11-03']);
  assert.deepEqual(filled.get('2026-11-01'), { territories: {}, sources: {}, devices: {} });
  assert.equal(filled.get('2026-11-03')?.territories.US?.firstDownloads, 2);
  assert.equal(fillMonthDays(new Map()).size, 0);
});
