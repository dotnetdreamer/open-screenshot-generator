// Growth: the report parsers, the merge that keeps re-imports idempotent, the
// metrics, the before and after test for new screenshots, the listing checks,
// and the insight rules, run against Apple's report shapes and the sample app.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { AscAuthError, listApps } from '@/lib/growth/asc';
import { gunzip, isGzip, parseDelimited, reportText } from '@/lib/growth/delimited';
import { parseSalesReport, salesRowKind } from '@/lib/growth/salesReport';
import {
  analyticsReportKind,
  combineBatches,
  parseDownloadsReport,
  parseEngagementReport,
  sourceTypeOf,
} from '@/lib/growth/analyticsReport';
import { dayTotal, emptyFeedDay, mergeFeed } from '@/lib/growth/records';
import {
  completeThrough,
  covers,
  dailySeries,
  dayValues,
  feedStarts,
  indexRecords,
  latestDay,
  metricValue,
  primaryCurrency,
  proceedsCurrency,
  totalsFor,
} from '@/lib/growth/metrics';
import {
  CONFIDENT,
  EARLY_CONFIDENT,
  compareVersions,
  confidenceBar,
  describeEvents,
  eventImpact,
  liveDateFor,
  proportionConfidence,
  verdictFor,
  versionOf,
} from '@/lib/growth/impact';
import { checkListing, cleanKeywords, collapseChanges } from '@/lib/growth/listingChecks';
import { buildInsights } from '@/lib/growth/insights';
import { topicsOf } from '@/lib/growth/reviewTopics';
import { territoryCode, listingLanguageFor, languageCovers } from '@/lib/growth/territories';
import { addDays, dayRange, normalizeDay, shiftYears, weekStart } from '@/lib/growth/dates';
import {
  SAMPLE_APP_ID,
  SAMPLE_OFFSETS,
  sampleEvents,
  sampleListing,
  sampleRatings,
  sampleRecords,
  sampleReviews,
} from '../fixtures/growthSample';
import { buildDigest } from '@/lib/growth/digest';
import {
  buildReport,
  comparisonNote,
  earlierPeriod,
  latestCompletePeriod,
  periodBefore,
  periodTitle,
  reportFacts,
  reportMarkdown,
} from '@/lib/growth/report';
import { pageCuts, pdfString, writePdf } from '@/lib/growth/reportPdf';
import { dueForAutoSync, forgetAutoSync, noteAutoSync, resetAutoSync } from '@/lib/growth/autoSync';
import { rebaseChanges, withoutApplied } from '@/lib/growth/listingDrafts';
import { analyticsCoverage, instanceDays, readSince, snapshotDue } from '@/lib/growth/sync';
import { formatPerDay } from '@/lib/growth/format';
import { noteAppleClock } from '@/lib/publish/appStoreConnect';
import { plainProse } from '@/lib/growth/ai';
import { FreeProviderError, runFreeProvider } from '@/lib/ai/freeProviders';
import { today } from '@/lib/growth/dates';

const SALES_HEADER = [
  'Provider', 'Provider Country', 'SKU', 'Developer', 'Title', 'Version', 'Product Type Identifier', 'Units',
  'Developer Proceeds', 'Begin Date', 'End Date', 'Customer Currency', 'Country Code', 'Currency of Proceeds',
  'Apple Identifier', 'Customer Price', 'Promo Code', 'Parent Identifier', 'Subscription', 'Period',
].join('\t');

function salesRow(cells: Record<string, string>): string {
  const order = SALES_HEADER.split('\t');
  return order.map((name) => cells[name] ?? '').join('\t');
}

test('sales report rows are classified by product type', () => {
  assert.equal(salesRowKind('1F'), 'download');
  assert.equal(salesRowKind('F1'), 'download');
  assert.equal(salesRowKind('3'), 'redownload');
  assert.equal(salesRowKind('7T'), 'update');
  assert.equal(salesRowKind('IAY'), 'iap');
  assert.equal(salesRowKind('IA1-M'), 'iap');
  assert.equal(salesRowKind('IA3'), 'ignored');
  assert.equal(salesRowKind('XYZ'), 'ignored');
});

test('a sales report counts units, attributes purchases by parent SKU and sums proceeds per currency', () => {
  const text = [
    SALES_HEADER,
    salesRow({ SKU: 'JUNIPER', 'Product Type Identifier': '1F', Units: '12', 'Developer Proceeds': '0', 'Begin Date': '03/04/2026', 'Country Code': 'US', 'Currency of Proceeds': 'USD', 'Apple Identifier': '111' }),
    salesRow({ SKU: 'JUNIPER', 'Product Type Identifier': '3F', Units: '2', 'Begin Date': '03/04/2026', 'Country Code': 'US', 'Currency of Proceeds': 'USD', 'Apple Identifier': '111' }),
    salesRow({ SKU: 'JUNIPER', 'Product Type Identifier': '7F', Units: '30', 'Begin Date': '03/04/2026', 'Country Code': 'DE', 'Currency of Proceeds': 'EUR', 'Apple Identifier': '111' }),
    salesRow({ SKU: 'PLUS_YEAR', 'Product Type Identifier': 'IAY', Units: '3', 'Developer Proceeds': '17.49', 'Begin Date': '03/04/2026', 'Country Code': 'DE', 'Currency of Proceeds': 'EUR', 'Apple Identifier': '999', 'Parent Identifier': 'JUNIPER' }),
    salesRow({ SKU: 'PLUS_YEAR', 'Product Type Identifier': 'IAY', Units: '-1', 'Developer Proceeds': '17.49', 'Begin Date': '03/04/2026', 'Country Code': 'DE', 'Currency of Proceeds': 'EUR', 'Apple Identifier': '999', 'Parent Identifier': 'JUNIPER' }),
    salesRow({ SKU: 'OTHER_IAP', 'Product Type Identifier': 'IA1', Units: '5', 'Developer Proceeds': '0.69', 'Begin Date': '03/04/2026', 'Country Code': 'JP', 'Currency of Proceeds': 'JPY', 'Apple Identifier': '777', 'Parent Identifier': 'ELSEWHERE' }),
    salesRow({ SKU: 'PLUS_YEAR', 'Product Type Identifier': 'IA3', Units: '9', 'Begin Date': '03/04/2026', 'Country Code': 'US', 'Currency of Proceeds': 'USD', 'Apple Identifier': '999', 'Parent Identifier': 'JUNIPER' }),
  ].join('\n');

  const result = parseSalesReport(text);
  assert.deepEqual(result.skus, { JUNIPER: '111' });
  assert.equal(result.unattributed, 1);
  const day = result.byApp.get('111')?.get('2026-03-04');
  assert.ok(day, 'the app has a day');
  assert.equal(day.territories.US.units, 12);
  assert.equal(day.territories.US.reunits, 2);
  assert.equal(day.territories.US.iapUnits, undefined, 'a restore is not a purchase');
  assert.equal(day.territories.DE.updates, 30);
  assert.equal(day.territories.DE.iapUnits, 2, 'the refund nets out');
  assert.equal(day.territories.DE.proceeds?.EUR, 34.98);

  // A purchase on a day its app had no downloads is attributed through the SKU learned earlier.
  const later = parseSalesReport(
    [
      SALES_HEADER,
      salesRow({ SKU: 'PLUS_YEAR', 'Product Type Identifier': 'IAY', Units: '1', 'Developer Proceeds': '9.99', 'Begin Date': '03/05/2026', 'Country Code': 'US', 'Currency of Proceeds': 'USD', 'Apple Identifier': '999', 'Parent Identifier': 'JUNIPER' }),
    ].join('\n'),
    result.skus
  );
  assert.equal(later.byApp.get('111')?.get('2026-03-05')?.territories.US.proceeds?.USD, 9.99);
});

test('report bodies are inflated only when they are gzip', async () => {
  const plain = 'Date\tEvent\n2026-01-02\tImpression\n';
  const bytes = new TextEncoder().encode(plain);
  assert.equal(isGzip(bytes), false);
  assert.equal(await reportText(bytes), plain);

  const zipped = new Uint8Array(
    await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()
  );
  assert.equal(isGzip(zipped), true);
  assert.equal(new TextDecoder().decode(await gunzip(zipped)), plain);
  assert.equal(await reportText(zipped), plain);
});

test('a delimited file picks tabs or commas from its header, and honours quotes', () => {
  const tabbed = parseDelimited('A\tB\tC\n1\t2\t3\n');
  assert.deepEqual(tabbed.header, ['A', 'B', 'C']);
  assert.deepEqual(tabbed.rows, [['1', '2', '3']]);
  const csv = parseDelimited('"Name","Count"\n"Hello, world",3\r\n');
  assert.deepEqual(csv.header, ['Name', 'Count']);
  assert.deepEqual(csv.rows, [['Hello, world', '3']]);
});

const ENGAGEMENT = [
  ['Date', 'App Name', 'App Apple Identifier', 'Event', 'Page Type', 'Source Type', 'Engagement Type', 'Device', 'Platform Version', 'Territory', 'Counts', 'Unique Counts'].join('\t'),
  ['2026-03-04', 'Juniper', '111', 'Impression', 'No page', 'App Store search', '', 'iPhone', 'iOS 19.1', 'US', '1000', '800'].join('\t'),
  ['2026-03-04', 'Juniper', '111', 'Impression', 'No page', 'App Store browse', '', 'iPad', 'iPadOS 19.1', 'DE', '500', '400'].join('\t'),
  ['2026-03-04', 'Juniper', '111', 'Page view', 'Product page', 'App Store search', '', 'iPhone', 'iOS 19.1', 'US', '120', '100'].join('\t'),
  ['2026-03-04', 'Juniper', '111', 'Tap', 'Product page', 'App Store search', 'Get', 'iPhone', 'iOS 19.1', 'US', '60', '55'].join('\t'),
  ['2026-03-05', 'Juniper', '222', 'Impression', 'No page', 'App Store search', '', 'iPhone', 'iOS 19.1', 'US', '99999', '99999'].join('\t'),
].join('\n');

const DOWNLOADS = [
  ['Date', 'App Name', 'App Apple Identifier', 'Download Type', 'App Version', 'Device', 'Platform Version', 'Source Type', 'Page Type', 'Pre-Order', 'Territory', 'Counts'].join('\t'),
  ['2026-03-04', 'Juniper', '111', 'First-time download', '2.4', 'iPhone', 'iOS 19.1', 'App Store search', 'Product page', 'No', 'US', '30'].join('\t'),
  ['2026-03-04', 'Juniper', '111', 'First-time download', '2.4', 'iPhone', 'iOS 19.1', 'App Store search', 'No Page', 'No', 'US', '10'].join('\t'),
  ['2026-03-04', 'Juniper', '111', 'Redownload', '2.4', 'iPad', 'iPadOS 19.1', 'Web referrer', 'Product page', 'No', 'DE', '5'].join('\t'),
  ['2026-03-04', 'Juniper', '111', 'Auto-update', '2.4', 'iPhone', 'iOS 19.1', 'Unavailable', 'No Page', 'No', 'US', '400'].join('\t'),
].join('\n');

test('the engagement report splits impressions and page views by territory, source and device', () => {
  const batch = parseEngagementReport(ENGAGEMENT, { appId: '111' });
  assert.deepEqual(Array.from(batch.keys()), ['2026-03-04'], 'the other app\'s row is left out');
  const day = batch.get('2026-03-04')!;
  assert.equal(day.territories.US.impressions, 1000);
  assert.equal(day.territories.US.uniqueImpressions, 800);
  assert.equal(day.territories.US.pageViews, 120);
  assert.equal(day.territories.DE.impressions, 500);
  assert.equal(day.sources.search?.impressions, 1000);
  assert.equal(day.sources.browse?.impressions, 500);
  assert.equal(day.devices.iPad.impressions, 500);
  assert.equal(day.territories.US.pageViews, 120, 'taps are not page views');
});

test('the downloads report counts first-time downloads, redownloads and product page starts', () => {
  const batch = parseDownloadsReport(DOWNLOADS, { appId: '111' });
  const day = batch.get('2026-03-04')!;
  assert.equal(day.territories.US.firstDownloads, 40);
  assert.equal(day.territories.US.pageDownloads, 30);
  assert.equal(day.territories.DE.redownloads, 5);
  assert.equal(day.sources['web-referrer']?.redownloads, 5);
  assert.equal(day.territories.US.redownloads, undefined, 'updates are not downloads');
});

test('a day an analytics file lists with nothing counted is a zero of that report, not a day for Sales and Trends', () => {
  // Shaped like a real Ludo Wala day (November 2026): auto-updates only, and
  // another app's first-time download that must not count.
  const downloads = [
    DOWNLOADS.split('\n')[0],
    ['2026-03-06', 'Juniper', '111', 'Auto-update', '2.4', 'iPhone', 'iOS 19.1', 'App Store search', 'Product page', 'No', 'US', '7'].join('\t'),
    ['2026-03-06', 'Juniper', '222', 'First-time download', '2.4', 'iPhone', 'iOS 19.1', 'App Store search', 'Product page', 'No', 'US', '9'].join('\t'),
  ].join('\n');
  const batch = parseDownloadsReport(downloads, { appId: '111' });
  assert.deepEqual(Array.from(batch.keys()), ['2026-03-06'], 'the day the file covers is there');
  assert.deepEqual(batch.get('2026-03-06'), emptyFeedDay(), 'with nothing counted: updates are not downloads, and the other app is left out');

  // Sales and Trends counted two units that day. The day is App Analytics' now, which said none.
  const sales = { territories: { US: { units: 2, updates: 7 } }, sources: {}, devices: {} };
  let record = mergeFeed(undefined, '111', '2026-03-06', 'sales', sales, 1);
  assert.equal(dayValues(record, '2026-03-06').downloads, 2, 'before App Analytics reports the day, Sales and Trends answers');
  record = mergeFeed(record, '111', '2026-03-06', 'downloads', batch.get('2026-03-06')!, 2);
  assert.equal(dayValues(record, '2026-03-06').downloads, 0);
  assert.equal(dayValues(record, '2026-03-06').firstDownloads, 0);
  assert.equal(dayValues(record, '2026-03-06').updates, 7, 'updates still come from Sales and Trends');
  // And the newest such day no longer holds every window back to the day before.
  const before = mergeFeed(
    mergeFeed(undefined, '111', '2026-03-05', 'sales', { territories: { US: { units: 1 } }, sources: {}, devices: {} }, 1),
    '111',
    '2026-03-05',
    'downloads',
    { territories: { US: { firstDownloads: 1 } }, sources: {}, devices: {} },
    1
  );
  assert.equal(completeThrough([before, record]), '2026-03-06');

  const taps = [ENGAGEMENT.split('\n')[0], ['2026-03-06', 'Juniper', '111', 'Tap', 'Product page', 'App Store search', 'Get', 'iPhone', 'iOS 19.1', 'US', '3', '3'].join('\t')].join('\n');
  assert.deepEqual(Array.from(parseEngagementReport(taps, { appId: '111' }).keys()), ['2026-03-06'], 'a day with only taps was reported too');
});

test('an analytics file covers its own days, quiet ones too, and never the days between two files', () => {
  // The rows of Ludo Wala's downloads snapshot of November 2026 around the two
  // days it has none for, Oct 31 and Nov 1, which were quiet.
  const snapshot = instanceDays('2026-11-12', true, ['2026-10-29', '2026-10-30', '2026-11-02', '2026-11-12']);
  assert.deepEqual(snapshot, dayRange('2026-10-29', '2026-11-12'));
  assert.ok(snapshot.includes('2026-10-31') && snapshot.includes('2026-11-01'));
  assert.deepEqual(instanceDays('2026-11-12', true, ['2026-11-05', '2026-10-01']).at(-1), '2026-11-12', 'a snapshot reaches its processing date, quiet last days and all');
  assert.deepEqual(instanceDays('2026-11-12', true, []), [], 'an empty snapshot says nothing about any day');

  // The daily files of the same week: two days of downloads, three of engagement.
  assert.deepEqual(instanceDays('2026-11-13', false, ['2026-11-11', '2026-11-12']), ['2026-11-11', '2026-11-12']);
  assert.deepEqual(instanceDays('2026-11-13', false, ['2026-11-12', '2026-11-10']), ['2026-11-10', '2026-11-11', '2026-11-12'], 'a quiet day among its recent ones');
  assert.deepEqual(instanceDays('2026-11-13', false, []), ['2026-11-12'], 'a daily file with no rows still answers for the day before its processing date');
  assert.deepEqual(instanceDays('2026-11-13', false, ['2026-11-13']), ['2026-11-12', '2026-11-13']);
  assert.deepEqual(
    instanceDays('2026-11-13', false, ['2026-11-12', '2026-10-20']),
    ['2026-10-20', '2026-11-12'],
    'a correction for an old date stands alone: the weeks before it are not this file\'s'
  );
  assert.deepEqual(instanceDays('', false, ['2026-11-12']), ['2026-11-12'], 'without a processing date, only the dates it has rows for');
});

test('a day no analytics file covered is missing, not a zero, and Growth asks Apple for a snapshot about once a month', () => {
  const day = (date: string, feeds: Partial<Record<'engagement' | 'downloads' | 'sales', number>>, territories = {}) => ({
    key: `111|${date}`,
    appId: '111',
    date,
    territories,
    sources: {},
    devices: {},
    feeds,
  });
  const records = [
    day('2026-03-01', { sales: 1, downloads: 1, engagement: 1 }),
    day('2026-03-02', { sales: 1, downloads: 1, engagement: 1 }),
    // Apple deleted the files of these days before a sync read them.
    day('2026-03-03', { sales: 1 }, { US: { units: 9 } }),
    day('2026-03-04', { sales: 1, engagement: 1 }),
    day('2026-03-05', { sales: 1, downloads: 1, engagement: 1 }),
    day('2026-03-06', { sales: 1, engagement: 1 }),
    day('2026-03-07', { sales: 1 }),
  ];
  assert.deepEqual(analyticsCoverage(records), {
    newest: '2026-03-06',
    missing: ['2026-03-03', '2026-03-04'],
    byReport: { engagement: ['2026-03-03'], downloads: ['2026-03-03', '2026-03-04'] },
  });
  assert.equal(dayValues(records[2], '2026-03-03').downloads, 9, 'the downloads Sales and Trends saw on a missing day are kept');
  assert.deepEqual(analyticsCoverage([day('2026-03-01', { sales: 1 })]), { newest: null, missing: [], byReport: { engagement: [], downloads: [] } });

  const now = Date.parse('2026-12-20T12:00:00Z');
  const daysAgo = (days: number) => now - days * 86_400_000;
  const both = { engagement: true, downloads: true } as const;
  assert.equal(snapshotDue({}, 0, now), true, 'no snapshot read and none asked for');
  assert.equal(snapshotDue({ snapshotAskedAt: daysAgo(2) }, 0, now), false, 'one asked for two days ago is on its way');
  assert.equal(snapshotDue({ snapshotRead: both }, 0, now), false, 'nothing missing');
  assert.equal(snapshotDue({ snapshotRead: { downloads: true } }, 0, now), true, 'the other report\'s snapshot never came');
  assert.equal(snapshotDue({ snapshotRead: both }, 2, now), true);
  assert.equal(snapshotDue({ snapshotRead: both, snapshotAskedAt: daysAgo(30) }, 2, now), false, 'Apple makes one about every 31 days');
  assert.equal(snapshotDue({ snapshotRead: both, snapshotAskedAt: daysAgo(31) }, 2, now), true);
  assert.equal(snapshotDue({ snapshotRead: both, snapshotAskedAt: daysAgo(1), snapshotRefused: true }, 2, now), true, 'a key that may not ask tries again a day later');
});

test('the overview an agent reads names the days no analytics file covered, and compares a number only as far back as its history reaches', () => {
  const T = '2026-03-31';
  const at = (back: number) => addDays(T, -back);
  type Feed = 'engagement' | 'downloads' | 'sales';
  const day = (back: number, feeds: Feed[]) => ({
    key: `111|${at(back)}`,
    appId: '111',
    date: at(back),
    territories: { US: { impressions: 100, uniqueImpressions: 80, pageViews: 20, uniquePageViews: 16, firstDownloads: 4, pageDownloads: 2, units: 5 } },
    sources: {},
    feeds: Object.fromEntries(feeds.map((feed) => [feed, 1])) as Partial<Record<Feed, number>>,
  });
  // Downloads and Sales and Trends go back 20 days, impressions only 10, so
  // the earlier of the two 7-day windows (13 to 7 days back) starts before
  // the impressions do.
  const records = (gaps: Record<number, Feed[]> = {}) =>
    Array.from({ length: 21 }, (_, back) =>
      day(back, gaps[back] ?? (back > 10 ? ['downloads', 'sales'] : ['engagement', 'downloads', 'sales']))
    );
  const digestOf = (list: ReturnType<typeof records>) =>
    buildDigest({
      appId: '111',
      appName: 'Juniper',
      records: list,
      reviews: [],
      ratings: [],
      events: [],
      insights: [],
      listing: null,
      listingIssues: [],
      days: 7,
      today: addDays(T, 2),
    });
  const missingNotes = (digest: ReturnType<typeof digestOf>) => digest.notes.filter((note) => note.startsWith('App Analytics has no'));

  const whole = digestOf(records());
  assert.equal(whole.dataCompleteThrough, T);
  const totals = whole.totals as { previous: Record<string, unknown>; change: Record<string, string> };
  assert.equal(totals.previous.impressions, null, 'as on the Overview, impressions that start partway through the earlier window are not compared');
  assert.equal(totals.previous.conversionRate, null);
  assert.ok(!('impressions' in totals.change));
  assert.equal(totals.previous.firstTimeDownloads, 28, 'downloads reach back over the whole earlier window');
  assert.ok('firstTimeDownloads' in totals.change);
  assert.deepEqual(missingNotes(whole), []);

  // Apple deleted the files of two days before a sync read them, and the
  // downloads of a third, which Sales and Trends has not reported either. A
  // gap before the earlier window plays no part in the comparison.
  const gapped = digestOf(records({ 4: ['sales'], 3: ['sales'], 1: ['engagement'], 18: ['sales'] }));
  assert.deepEqual(missingNotes(gapped), [
    `App Analytics has no impressions or page views for 2 days in these windows (${at(4)} to ${at(3)}). Impressions, page views and conversion leave those days out, so a change across them may not be real.`,
    `App Analytics has no downloads for 3 days in these windows (${at(4)} to ${at(3)}, ${at(1)}). First-time downloads come from Sales and Trends on the days it has, and the product page conversion rate leaves all of them out.`,
  ]);
  const covered = digestOf(records({ 4: ['sales'], 3: ['sales'] }));
  assert.match(missingNotes(covered)[1], /on those days come from Sales and Trends instead/);
});

test('a daily average keeps a decimal below ten, so 2.3 and 1.9 a day do not both read as 2', () => {
  assert.equal(formatPerDay(2.3), '2.3');
  assert.equal(formatPerDay(1.93), '1.9');
  assert.equal(formatPerDay(2), '2');
  assert.equal(formatPerDay(9.96), '10');
  assert.equal(formatPerDay(12.4), '12');
  assert.equal(formatPerDay(null), 'n/a');
});

test('report names and source labels resolve to what the feature reads', () => {
  assert.equal(analyticsReportKind('App Store Discovery and Engagement Standard'), 'engagement');
  assert.equal(analyticsReportKind('App Store Discovery and Engagement Detailed'), null);
  assert.equal(analyticsReportKind('App Downloads Standard'), 'downloads');
  assert.equal(analyticsReportKind('App Crashes Expanded'), null);
  assert.equal(sourceTypeOf('App Store search'), 'search');
  assert.equal(sourceTypeOf('Institutional purchase'), 'institutional');
  assert.equal(sourceTypeOf('Something new'), 'unavailable');
});

test('merging a feed replaces its own numbers for the day and leaves the other feeds alone', () => {
  const engagement = parseEngagementReport(ENGAGEMENT, { appId: '111' }).get('2026-03-04')!;
  const downloads = parseDownloadsReport(DOWNLOADS, { appId: '111' }).get('2026-03-04')!;
  let record = mergeFeed(undefined, '111', '2026-03-04', 'engagement', engagement, 1);
  record = mergeFeed(record, '111', '2026-03-04', 'downloads', downloads, 2);
  const once = dayTotal(record);
  // The same instance again, as a retry or an overlapping instance would deliver it.
  record = mergeFeed(record, '111', '2026-03-04', 'engagement', engagement, 3);
  assert.deepEqual(dayTotal(record), once, 'a re-import changes nothing');
  assert.equal(once.impressions, 1500);
  assert.equal(once.firstDownloads, 40);

  // A correction replaces the old figure instead of adding to it.
  const corrected = parseEngagementReport(ENGAGEMENT.replace('\t1000\t800', '\t1100\t880'), { appId: '111' }).get('2026-03-04')!;
  record = mergeFeed(record, '111', '2026-03-04', 'engagement', corrected, 4);
  assert.equal(dayTotal(record).impressions, 1600);
  assert.equal(dayTotal(record).firstDownloads, 40, 'downloads were not touched');
  assert.deepEqual(Object.keys(record.feeds).sort(), ['downloads', 'engagement']);
});

test('segments of one instance combine before they replace anything', () => {
  const half = ENGAGEMENT.split('\n');
  const first = parseEngagementReport([half[0], half[1]].join('\n'));
  const second = parseEngagementReport([half[0], half[2]].join('\n'));
  const combined = combineBatches([first, second]).get('2026-03-04')!;
  assert.equal(combined.territories.US.impressions, 1000);
  assert.equal(combined.territories.DE.impressions, 500);
});

test('territory codes come out as two letters from any of the forms Apple writes', () => {
  assert.equal(territoryCode('USA'), 'US');
  assert.equal(territoryCode('us'), 'US');
  assert.equal(territoryCode('DEU'), 'DE');
  assert.equal(territoryCode('United Kingdom'), 'GB');
  assert.equal(territoryCode('Korea, Republic of'), 'KR');
  assert.equal(territoryCode(''), 'ZZ');
  assert.equal(listingLanguageFor('JP'), 'ja');
  assert.equal(languageCovers('en-GB', 'en-US'), true);
  assert.equal(languageCovers('zh-Hans', 'zh-Hant'), false);
});

test('dates in every report shape normalize to one day', () => {
  assert.equal(normalizeDay('03/04/2026'), '2026-03-04');
  assert.equal(normalizeDay('2026-03-04T23:30:00-08:00'), '2026-03-04');
  assert.equal(normalizeDay('20260304'), '2026-03-04');
  assert.equal(normalizeDay('nonsense'), null);
  assert.equal(weekStart('2026-03-08'), '2026-03-02', 'Sunday belongs to the week that began on Monday');
  assert.equal(dayRange('2026-02-27', '2026-03-02').length, 4);
});

test('the sample app has analytics two days back and sales one day back', () => {
  const records = sampleRecords();
  const latest = latestDay(records)!;
  assert.equal(latest, addDays(today(), -1));
  const through = completeThrough(records)!;
  assert.equal(through, addDays(today(), -2), 'windows end where both feeds have reported');
});

test('conversion is only computed over days that have both halves', () => {
  const records = sampleRecords();
  const byDate = indexRecords(records);
  const latest = latestDay(records)!;
  const lastDayOnly = totalsFor(byDate, { from: latest, to: latest });
  assert.equal(lastDayOnly.hasEngagement, false);
  assert.equal(lastDayOnly.conversion, null, 'a day with downloads and no impressions has no rate');
  assert.ok(lastDayOnly.downloads > 0, 'Sales and Trends still supplies its downloads');
  const series = dailySeries(byDate, { from: addDays(latest, -3), to: latest }, 'conversion');
  assert.equal(series[series.length - 1].value, null);
  assert.ok((series[0].value ?? 0) > 0.02);
});

test('proportion confidence is near zero for equal rates and near one for a large clear gap', () => {
  assert.ok((proportionConfidence(100, 1000, 100, 1000) ?? 1) < 0.01);
  assert.ok((proportionConfidence(300, 10_000, 380, 10_000) ?? 0) > 0.99);
  assert.equal(proportionConfidence(1, 0, 1, 10), null);
});

test('new screenshots are measured from the release of their version, and the sample set wins', () => {
  const records = sampleRecords();
  const events = sampleEvents();
  const shots = events.find((event) => event.kind === 'screenshots')!;
  const release = events.find((event) => event.version === '2.4' && event.kind === 'release')!;
  assert.equal(liveDateFor(shots, events), release.date);
  assert.equal(liveDateFor(shots, events.filter((event) => event !== release)), null, 'not live until 2.4 ships');

  const impact = eventImpact(indexRecords(records), shots, { latest: completeThrough(records)!, events });
  assert.equal(impact.measure, 'conversion');
  assert.equal(impact.verdict, 'better');
  assert.ok(impact.change! > 0.1 && impact.change! < 0.3, `lift was ${impact.change}`);
  assert.ok(impact.confidence! > 0.99);
  assert.equal(impact.daysAfter, 14);
});

test('screenshots whose own release was never seen go live no later than the next version', () => {
  const base = { appId: 'a', origin: 'auto' as const, createdAt: 0 };
  const shots = { ...base, id: 's', date: '2026-10-01', kind: 'screenshots' as const, title: 'New screenshots', version: '2.0', origin: 'publish' as const };
  // 2.0 and 2.0.1 both came out between two syncs, so only 2.0.1 is on the timeline.
  const later = { ...base, id: 'r2', date: '2026-10-09', kind: 'release' as const, title: 'Version 2.0.1 released', version: '2.0.1' };
  const older = { ...base, id: 'r1', date: '2026-09-01', kind: 'release' as const, title: 'Version 1.9 released', version: '1.9' };
  assert.equal(liveDateFor(shots, [older, later]), '2026-10-09');
  assert.equal(liveDateFor(shots, [older]), null, 'nothing newer is out, so it is still waiting');
  assert.ok(compareVersions('2.10', '2.9') > 0);
  assert.equal(compareVersions('2.0', '2.0.0'), 0);
  assert.ok(compareVersions('1.9.9', '2.0') < 0);
});

test('a version is read from the event field first and never from a date', () => {
  const base = { id: 'x', appId: 'a', date: '2026-11-03', kind: 'release' as const, origin: 'manual' as const, createdAt: 0 };
  assert.equal(versionOf({ ...base, title: 'Shipped Nov 3' }), null);
  assert.equal(versionOf({ ...base, title: 'v3.2 released' }), '3.2');
  assert.equal(versionOf({ ...base, title: 'Release', version: '4.0.1' }), '4.0.1');
});

test('the keyword cleanup drops spaces, repeats and words the name and subtitle already have', () => {
  const english = sampleListing().locales[0];
  const cleanup = cleanKeywords(english);
  assert.ok(!cleanup.keywords.includes(' ,') && !cleanup.keywords.includes(', '));
  const kept = cleanup.keywords.split(',');
  assert.ok(!kept.includes('habit'), 'habit is in the name');
  assert.ok(!kept.includes('habits'), 'habits folds into habit');
  assert.ok(!kept.includes('streak'), 'streaks is in the subtitle');
  assert.ok(kept.includes('routine'));
  assert.ok(kept.includes('daily planner'));
  assert.ok(cleanup.saved > 20, `saved ${cleanup.saved}`);
});

test('a keyword that is repeated and also in the name is reported as both, and a kept phrase is not a repeat', () => {
  const cleanup = cleanKeywords({ locale: 'en-US', name: 'Pebble Notes', subtitle: 'Calm lists', keywords: 'notes, notes,journal,daily journal,memo' });
  assert.deepEqual(cleanup.removedDuplicates, ['notes']);
  assert.deepEqual(cleanup.removedIndexed, ['notes']);
  assert.equal(cleanup.keywords, 'journal,daily journal,memo');
  const ids = checkListing({
    ...sampleListing(),
    locales: [{ ...sampleListing().locales[0], name: 'Pebble Notes', subtitle: 'Calm lists', keywords: 'notes, notes,journal' }],
  }).map((entry) => entry.title);
  assert.ok(ids.includes('"notes" appears twice in the keywords'), ids.join(' | '));
  assert.ok(ids.includes('"notes" is already in the name or subtitle'), ids.join(' | '));
});

test('a small app gets no language cards from a handful of downloads', () => {
  // The shape of a real small app: 16 downloads in a month, three of them from Saudi Arabia.
  const spread: Record<string, number> = { US: 4, SA: 3, FR: 1, PH: 1, GR: 1, SK: 1, BR: 1, TR: 1, ID: 1, MN: 1, IN: 1 };
  let records: ReturnType<typeof sampleRecords> = [];
  Object.entries(spread).forEach(([territory, units], index) => {
    const date = addDays(today(), -2 - index);
    records.push(mergeFeed(undefined, 'small', date, 'sales', { territories: { [territory]: { units } }, sources: {}, devices: {} }, 1));
  });
  records = records.sort((a, b) => a.date.localeCompare(b.date));
  const listing = { ...sampleListing(), appId: 'small', locales: [sampleListing().locales[0]] };
  const insights = buildInsights({ appId: 'small', records, reviews: [], ratings: [], events: [], listing, listingIssues: [], today: today() });
  assert.equal(insights.filter((insight) => insight.kind === 'localize').length, 0, insights.map((insight) => insight.title).join(' | '));
});

test('the headline currency is the one worth most, not the one with the biggest number', () => {
  assert.equal(primaryCurrency({ USD: 100, JPY: 9000, KRW: 50_000 }), 'USD');
  assert.equal(primaryCurrency({ USD: 10, JPY: 9000 }), 'JPY');
  assert.equal(primaryCurrency({}), 'USD');
});

test('the listing checks find the sample listing\'s problems', () => {
  const issues = checkListing(sampleListing());
  const ids = issues.map((entry) => entry.id);
  assert.ok(ids.includes('en-US:keywords:spaces'));
  assert.ok(ids.includes('en-US:keywords:indexed'));
  assert.ok(ids.includes('en-US:whatsNew:generic'));
  assert.ok(ids.includes('de-DE:subtitle:repeats-name'));
  assert.ok(ids.includes('de-DE:description:short'));
  assert.ok(ids.includes('de-DE:listing:screenshots-borrowed'));
  assert.ok(ids.some((id) => id.startsWith('fr-FR:') && id.endsWith(':untranslated')));
  assert.ok(ids.includes('es-MX:listing:few-screenshots'));
  assert.equal(issues[0].severity === 'tip', false, 'problems and warnings sort first');
  const fix = issues.find((entry) => entry.id === 'en-US:keywords:indexed')!.fix!;
  assert.equal(fix.field, 'keywords');
  assert.equal(collapseChanges([fix, { ...fix, after: 'routine' }])[0].before, fix.before);
});

test('review topics catch complaints in several languages and ignore praise in low ratings', () => {
  assert.deepEqual(topicsOf({ rating: 1, title: 'Crashes', body: 'It crashes on launch' }), ['crash']);
  assert.ok(topicsOf({ rating: 2, title: 'Stürzt ab', body: 'Seit dem Update' }).includes('crash'));
  assert.ok(topicsOf({ rating: 5, title: 'Love it', body: 'Great app' }).includes('praise'));
  assert.ok(!topicsOf({ rating: 1, title: 'I loved it', body: 'until the update' }).includes('praise'));
});

test('the sample app produces the insights the feature promises', () => {
  const listing = sampleListing();
  const insights = buildInsights({
    appId: SAMPLE_APP_ID,
    records: sampleRecords(),
    reviews: sampleReviews(),
    ratings: sampleRatings(),
    events: sampleEvents(),
    listing,
    listingIssues: checkListing(listing),
    today: today(),
  });
  const kinds = new Set(insights.map((insight) => insight.kind));
  assert.ok(kinds.has('screenshots-impact'), 'measures the new screenshots');
  assert.ok(insights.find((insight) => insight.kind === 'screenshots-impact')!.tone === 'good');
  assert.ok(kinds.has('featured'), `spots the feature placement, got ${Array.from(kinds).join(', ')}`);
  assert.ok(kinds.has('localize'), 'spots Japan reading the listing in another language');
  assert.ok(insights.some((insight) => insight.kind === 'localize' && insight.action?.kind === 'localize' && insight.action.locales.includes('ja')));
  assert.ok(kinds.has('review-topic'), 'spots the crash reviews');
  assert.ok(kinds.has('unanswered'));
  assert.ok(kinds.has('listing'));
  assert.equal(new Set(insights.map((insight) => insight.id)).size, insights.length, 'ids are unique');
  for (let index = 1; index < insights.length; index += 1) {
    assert.ok(insights[index - 1].weight >= insights[index].weight, 'sorted by weight');
  }
  for (const insight of insights) {
    assert.ok(!/[–—]/.test(insight.title + insight.body), `no dashes in "${insight.title}"`);
  }
});

test('a period that starts before the app\'s first number says where the numbers start, and owes only the days after', () => {
  // An app out since August 23 (Ludo Wala, November 2026), with one day inside its numbers missing.
  const records = dayRange('2026-08-23', '2026-11-12')
    .filter((date) => date !== '2026-10-05')
    .map((date) => mergeFeed(undefined, '111', date, 'sales', { territories: { US: { units: 2 } }, sources: {}, devices: {} }, 1));
  const year = buildReport({ appName: 'Juniper', records, reviews: [], events: [], period: 'year', window: { from: '2026-01-01', to: '2026-11-12' } });
  assert.equal(year.numbersFrom, 'Aug 23, 2026');
  assert.equal(year.missingDays, 1, 'not the 234 days before the app had numbers');
  const markdown = reportMarkdown(year);
  assert.ok(markdown.includes('Your numbers start on Aug 23, 2026.'));
  assert.ok(markdown.includes('Apple has not sent the numbers for 1 day of this period yet.'));
  assert.ok(reportFacts(year).includes('The numbers start on Aug 23, 2026'));
  assert.ok(reportFacts(year).includes('1 day in the period has no data yet.'));

  const october = buildReport({ appName: 'Juniper', records, reviews: [], events: [], period: 'month', window: { from: '2026-10-01', to: '2026-10-31' } });
  assert.equal(october.numbersFrom, null, 'a period inside the numbers says nothing about where they start');
  assert.equal(october.missingDays, 1);
});

test('the digest and the reports read the same figures', () => {
  const records = sampleRecords();
  const listing = sampleListing();
  const digest = buildDigest({
    appId: SAMPLE_APP_ID,
    appName: 'Juniper',
    records,
    reviews: sampleReviews(),
    ratings: sampleRatings(),
    events: sampleEvents(),
    insights: [],
    listing,
    listingIssues: checkListing(listing),
    today: today(),
  });
  assert.equal(digest.dataCompleteThrough, addDays(today(), -2));
  assert.ok(digest.topTerritories.length > 5);
  assert.ok(digest.reviews.latest.every((review) => !('nickname' in review)), 'no nicknames go to a model');

  const week = latestCompletePeriod(records, 'week')!;
  assert.equal(weekStart(week.from), week.from);
  assert.ok(week.to <= completeThrough(records)!);
  const report = buildReport({ appName: 'Juniper', records, reviews: sampleReviews(), events: sampleEvents(), period: 'week', window: week });
  assert.equal(report.missingDays, 0);
  const markdown = reportMarkdown(report, 'A good week.');
  assert.ok(markdown.includes('| New downloads |'));
  assert.ok(markdown.includes('A good week.'));
  assert.ok(!/[–—]/.test(markdown));
  const month = latestCompletePeriod(records, 'month')!;
  assert.ok(month.from.endsWith('-01'));
});

// The audit round of November 2026: one test for each fix.

test('product page views count only the product page, so the product page rate divides like by like', () => {
  const header = ENGAGEMENT.split('\n')[0];
  const views = [
    header,
    ['2026-03-04', 'Juniper', '111', 'Page view', 'Product page', 'App Store search', '', 'iPhone', 'iOS 19.1', 'US', '100', '100'].join('\t'),
    ['2026-03-04', 'Juniper', '111', 'Page view', 'App privacy', 'App Store search', '', 'iPhone', 'iOS 19.1', 'US', '900', '900'].join('\t'),
    ['2026-03-04', 'Juniper', '111', 'Page view', 'Media view', 'App Store search', '', 'iPhone', 'iOS 19.1', 'US', '40', '40'].join('\t'),
    ['2026-03-04', 'Juniper', '111', 'Impression', 'No page', 'App Store search', '', 'iPhone', 'iOS 19.1', 'US', '2000', '1500'].join('\t'),
  ].join('\n');
  const downloads = [
    DOWNLOADS.split('\n')[0],
    ['2026-03-04', 'Juniper', '111', 'First-time download', '2.4', 'iPhone', 'iOS 19.1', 'App Store search', 'Product page', 'No', 'US', '10'].join('\t'),
  ].join('\n');
  let record = mergeFeed(undefined, '111', '2026-03-04', 'engagement', parseEngagementReport(views).get('2026-03-04')!, 1);
  record = mergeFeed(record, '111', '2026-03-04', 'downloads', parseDownloadsReport(downloads).get('2026-03-04')!, 1);
  const totals = totalsFor(indexRecords([record]), { from: '2026-03-04', to: '2026-03-04' });
  assert.equal(totals.pageViews, 100, 'privacy and media pages are not the product page');
  assert.equal(totals.pageConversion, 0.1);
});

test('two periods are stated in one currency, so yen never sits under a dollar sign', () => {
  const sales = (date: string, proceeds: Record<string, number>) => {
    const day = emptyFeedDay();
    day.territories.US = { units: 1, proceeds };
    return mergeFeed(undefined, 'a', date, 'sales', day, 1);
  };
  const byDate = indexRecords([sales('2026-03-01', { USD: 1000 }), sales('2026-03-02', { JPY: 15_000 })]);
  const previous = totalsFor(byDate, { from: '2026-03-01', to: '2026-03-01' });
  const current = totalsFor(byDate, { from: '2026-03-02', to: '2026-03-02' });
  const currency = proceedsCurrency(current, previous);
  assert.equal(currency, 'USD', '1,000 dollars outweighs 15,000 yen');
  assert.equal(metricValue(current, 'proceeds', currency), 0);
  assert.equal(metricValue(previous, 'proceeds', currency), 1000);
  assert.equal(metricValue(current, 'proceeds'), 15_000, 'a span on its own keeps its own main currency');
});

test('a screenshot verdict waits for a week, needs 99% until the 14 days are in, and 90% after', () => {
  assert.equal(verdictFor(0.2, 0.999, 1, 14), 'too-early', 'one day is never enough');
  assert.equal(verdictFor(0.2, 0.999, 6, 14), 'too-early');
  assert.equal(verdictFor(0.2, 0.95, 7, 14), 'too-early', 'an early look needs 99%');
  assert.equal(verdictFor(0.2, 0.995, 7, 14), 'better');
  assert.equal(verdictFor(-0.2, 0.92, 14, 14), 'worse');
  assert.equal(verdictFor(0.01, 0.99, 14, 14), 'flat', 'a tiny change is not a result');
  assert.equal(verdictFor(0.1, 0.5, 14, 14), 'flat');
  assert.equal(confidenceBar(3), null);
  assert.equal(confidenceBar(7), EARLY_CONFIDENT);
  assert.equal(confidenceBar(14), CONFIDENT);
});

test('the before and after names what else changed in its weeks, but not the release that carried it', () => {
  const records = sampleRecords();
  const events = sampleEvents();
  const shots = events.find((event) => event.kind === 'screenshots')!;
  const release = events.find((event) => event.version === '2.4' && event.kind === 'release')!;
  const campaign = {
    id: 'campaign',
    appId: shots.appId,
    date: addDays(release.date, 3),
    kind: 'campaign' as const,
    title: 'Spring sale',
    origin: 'manual' as const,
    createdAt: 0,
  };
  const impact = eventImpact(indexRecords(records), shots, { latest: completeThrough(records)!, events: [...events, campaign] });
  assert.ok(impact.others.some((event) => event.id === 'campaign'));
  assert.ok(!impact.others.some((event) => event.id === release.id), 'the release is the change itself');
  // Nobody logged the sample's feature, but its browse impressions show it.
  assert.equal(impact.others.filter((event) => event.title === 'Apple probably featured your app').length, 1);
  assert.match(describeEvents(impact.others), /Spring sale \(/);
  const insight = buildInsights({
    appId: SAMPLE_APP_ID,
    records,
    reviews: [],
    ratings: [],
    events: [...events, campaign],
    listing: null,
    listingIssues: [],
    today: today(),
  }).find((entry) => entry.kind === 'screenshots-impact')!;
  assert.match(insight.title, /is up \d+% since your new screenshots went live/);
  assert.doesNotMatch(insight.title, /lifted/);
  assert.match(insight.body, /Spring sale/);
});

test('an app syncs on its own whenever its numbers are old, and a failed try waits an hour', () => {
  resetAutoSync();
  const now = Date.parse('2026-11-12T12:00:00Z');
  const hour = 3_600_000;
  assert.equal(dueForAutoSync('a', now - 7 * hour, 6, now), true);
  assert.equal(dueForAutoSync('a', now - hour, 6, now), false, 'fresh numbers');
  assert.equal(dueForAutoSync('a', null, 0, now), false, 'switched off');
  noteAutoSync('a', now);
  assert.equal(dueForAutoSync('a', now - 7 * hour, 6, now + 30 * 60_000), false, 'tried half an hour ago');
  assert.equal(dueForAutoSync('a', now - 7 * hour, 6, now + 61 * 60_000), true, 'an hour later it tries again');
  forgetAutoSync('a');
  assert.equal(dueForAutoSync('a', now - 7 * hour, 6, now), true, 'a stopped try is forgotten');
  // The audit's case: synced once, window reopened hours later in the same session.
  noteAutoSync('b', now);
  assert.equal(dueForAutoSync('b', now, 6, now + 7 * hour), true);
  resetAutoSync();
});

test('a period is compared only when the history reaches back over all of it', () => {
  const starts = { engagement: '2026-10-01', downloads: '2026-10-01', sales: '2026-06-01', installs: null, visits: null };
  assert.equal(covers(starts, 'downloads', { from: '2026-07-01', to: '2026-07-31' }), true, 'Sales and Trends covers downloads');
  assert.equal(covers(starts, 'impressions', { from: '2026-09-15', to: '2026-10-14' }), false);
  assert.equal(covers(starts, 'conversion', { from: '2026-10-01', to: '2026-10-31' }), true);
  assert.equal(covers(starts, 'proceeds', { from: '2026-05-01', to: '2026-05-31' }), false);
  assert.equal(covers({ engagement: null, downloads: null, sales: null, installs: null, visits: null }, 'downloads', { from: '2026-01-01', to: '2026-01-02' }), false);
  const records = sampleRecords();
  assert.equal(feedStarts(records).sales, records[0].date);
});

test('a yearly report is the year so far beside the same days a year before, then whole years', () => {
  const records = sampleRecords();
  const through = completeThrough(records)!;
  const year = latestCompletePeriod(records, 'year')!;
  assert.deepEqual(year, { from: `${through.slice(0, 4)}-01-01`, to: through });
  assert.deepEqual(periodBefore({ from: '2026-01-01', to: '2026-11-10' }, 'year'), { from: '2025-01-01', to: '2025-11-10' });
  assert.deepEqual(earlierPeriod({ from: '2026-01-01', to: '2026-11-10' }, 'year'), { from: '2025-01-01', to: '2025-12-31' });
  assert.equal(periodTitle({ from: '2025-01-01', to: '2025-12-31' }, 'year'), '2025');
  assert.equal(periodTitle({ from: '2026-01-01', to: '2026-11-10' }, 'year'), '2026 so far');
  assert.equal(shiftYears('2024-02-29', 1), '2025-02-28');
  assert.equal(shiftYears('2026-11-10', -1), '2025-11-10');
  // The sample goes back half a year, so nothing can stand beside the year before.
  const report = buildReport({ appName: 'Juniper', records, reviews: sampleReviews(), events: sampleEvents(), period: 'year', window: year });
  assert.ok(report.lines.length > 3);
  assert.ok(report.lines.every((line) => line.change === null));
  assert.match(comparisonNote(report) ?? '', /^Nothing is compared with /);
  assert.ok(reportMarkdown(report).includes(comparisonNote(report)!));
  assert.match(reportFacts(report), /year of/);
  // A week the sample fully covers is compared as before.
  const week = buildReport({ appName: 'Juniper', records, reviews: [], events: [], period: 'week', window: latestCompletePeriod(records, 'week')! });
  assert.ok(week.lines.some((line) => line.change !== null));
  assert.equal(comparisonNote(week), null);
});

test('a report PDF is a well formed file, with pages cut between blocks', () => {
  const blocks = [
    { top: 0, bottom: 100 },
    { top: 100, bottom: 900 },
    { top: 900, bottom: 1000 },
    { top: 1000, bottom: 1500 },
  ];
  assert.deepEqual(pageCuts(blocks, 1500, 1000), [[0, 1000], [1000, 1500]]);
  assert.deepEqual(pageCuts([{ top: 0, bottom: 1600 }, { top: 960, bottom: 1600 }], 1600, 1000), [[0, 960], [960, 1600]]);
  assert.deepEqual(pageCuts([{ top: 0, bottom: 2500 }], 2500, 1000), [[0, 1000], [1000, 2000], [2000, 2500]], 'a block taller than a page is cut');

  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const page = { jpeg, pixelWidth: 2, pixelHeight: 2, height: 100 };
  const text = Buffer.from(writePdf([page, { ...page, height: 50 }], 'Ludo वाला: 2026 so far')).toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4\n'));
  assert.ok(text.endsWith('%%EOF\n'));
  const xrefAt = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)![1]);
  const table = text.slice(xrefAt).split('\n');
  assert.equal(table[0], 'xref');
  assert.equal(table[1], '0 11');
  for (let id = 1; id <= 10; id += 1) {
    const offset = Number(table[2 + id].slice(0, 10));
    assert.ok(text.slice(offset).startsWith(`${id} 0 obj`), `object ${id} is where the table says`);
  }
  assert.match(text, /\/Count 2 /);
  assert.match(text, /\(Page 2 of 2\) Tj/);
  assert.match(text, /\/Title <FEFF/, 'a title outside ASCII is written as UTF-16');
  assert.equal(pdfString('Kanche'), '(Kanche)');
  assert.equal(pdfString('a(b)\\'), '(a\\(b\\)\\\\)');
});

test('a 401 is tried once more with a fresh token before it counts as a bad key', async () => {
  // Seen live: App Store Connect now and then answers a valid key with a 401
  // in the middle of a burst, and one such answer used to stop all of Sales.
  const privateKey = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const credentials = { issuerId: '69a6de70-0000-47e3-e053-5b8c7c11a4d1', keyId: 'RETRY12345', privateKey };
  const refused = () =>
    new Response(JSON.stringify({ errors: [{ status: '401', code: 'NOT_AUTHORIZED', title: 'Authentication credentials are missing or invalid.', detail: '' }] }), { status: 401 });
  const apps = () =>
    new Response(JSON.stringify({ data: [{ id: '1', type: 'apps', attributes: { name: 'Kanche', bundleId: 'com.example.kanche', sku: 'KANCHE', primaryLocale: 'en-US' } }], links: {} }), { status: 200 });
  const answers: Array<() => Response> = [refused, apps];
  const tokens: string[] = [];
  const root = globalThis as unknown as { window?: unknown };
  root.window = {
    fetch: async (_url: string, init: { headers: Record<string, string> }) => {
      tokens.push(init.headers.Authorization);
      return answers.shift()!();
    },
  };
  try {
    const listed = await listApps(credentials);
    assert.deepEqual(listed.map((entry) => entry.name), ['Kanche']);
    assert.equal(tokens.length, 2);
    assert.notEqual(tokens[0], tokens[1], 'the second try carries a newly minted token');

    answers.push(refused, refused);
    await assert.rejects(listApps(credentials), (error: unknown) => error instanceof AscAuthError, 'two refusals in a row are a bad key');
    assert.equal(tokens.length, 4);
  } finally {
    delete root.window;
  }
});

test('tokens are dated by Apple\'s clock once an answer shows this computer\'s is off', async () => {
  // Measured live in November 2026: Apple refuses a token dated more than
  // about two minutes ahead of its own clock, and the PC the feature was
  // tested on ran 96 seconds fast with its time service stopped.
  const privateKey = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const credentials = { issuerId: '69a6de70-0000-47e3-e053-5b8c7c11a4d1', keyId: 'CLOCK12345', privateKey };
  const lead = 10 * 60_000;
  const appleDate = () => new Date(Date.now() - lead).toUTCString();
  const refused = () =>
    new Response(JSON.stringify({ errors: [{ status: '401', code: 'NOT_AUTHORIZED', detail: 'Provide a properly configured and signed bearer token' }] }), {
      status: 401,
      headers: { date: appleDate() },
    });
  const apps = () =>
    new Response(JSON.stringify({ data: [{ id: '1', type: 'apps', attributes: { name: 'Kanche', bundleId: 'com.example.kanche', sku: 'KANCHE', primaryLocale: 'en-US' } }], links: {} }), {
      status: 200,
      headers: { date: appleDate() },
    });
  const answers: Array<() => Response> = [refused, apps, apps];
  const claims: Array<{ iat: number; exp: number }> = [];
  const root = globalThis as unknown as { window?: unknown };
  root.window = {
    fetch: async (_url: string, init: { headers: Record<string, string> }) => {
      claims.push(JSON.parse(Buffer.from(init.headers.Authorization.split('.')[1], 'base64url').toString()));
      return answers.shift()!();
    },
  };
  try {
    await listApps(credentials);
    assert.equal(claims.length, 2, 'the refusal was asked again once');
    const apple = (Date.now() - lead) / 1000;
    assert.ok(claims[0].iat > apple + 400, 'the first token went out on this computer\'s clock, ten minutes ahead');
    assert.ok(Math.abs(claims[1].iat - (apple - 60)) < 5, 'the second is dated a minute before Apple\'s now');
    assert.ok(Math.abs(claims[1].exp - (apple + 900)) < 5, 'and expires 15 minutes after it, inside Apple\'s 20');
    await listApps(credentials);
    assert.equal(claims[2].iat, claims[1].iat, 'the corrected token is kept for the next request');
  } finally {
    noteAppleClock({ headers: new Headers({ date: new Date().toUTCString() }) });
    delete root.window;
  }
});

test('applying keeps what was typed while Apple answered, and what Apple refused', () => {
  const sent = [
    { locale: 'en-US', field: 'subtitle' as const, before: 'Old', after: 'New' },
    { locale: 'en-US', field: 'keywords' as const, before: 'a,b', after: 'a,b,c' },
    { locale: 'en-US', field: 'description' as const, before: 'Long', after: 'Longer' },
  ];
  // Apple took the subtitle and the keywords and refused the description.
  const applied = sent.slice(0, 2);
  const latest = [
    { ...sent[0], after: 'New, then typed on while Apple answered' },
    sent[1],
    sent[2],
    { locale: 'de-DE', field: 'promotionalText' as const, before: '', after: 'Neu' },
  ];
  assert.deepEqual(
    withoutApplied(latest, applied).map((change) => `${change.locale}:${change.field}:${change.after}`),
    [
      'en-US:subtitle:New, then typed on while Apple answered',
      'en-US:description:Longer',
      'de-DE:promotionalText:Neu',
    ]
  );
});

test('an AI answer shown as plain text loses its Markdown marks', () => {
  // A live model answered the Ask AI screen with **bold**, which showed as asterisks.
  assert.equal(
    plainProse('## Answer\nThe **United States** led with `3,119` first-time downloads, __37%__ of them.'),
    'Answer\nThe United States led with 3,119 first-time downloads, 37% of them.'
  );
  assert.equal(plainProse('"Habits that stick"'), 'Habits that stick');
});

test('a free service that limits how often it answers says when to try again', async () => {
  // Pollinations' answer to a second keyless request inside 45 seconds (November 2026).
  const limited = JSON.stringify({
    status: 402,
    success: false,
    error: { code: 'FREE_LIMIT', message: 'Free limit reached: 1 reply every 45 seconds per IP. Retry after 36s, or get unlimited replies with a pollen key' },
  });
  const root = globalThis as unknown as { window?: unknown };
  root.window = { fetch: async () => new Response(limited, { status: 402 }) };
  try {
    await assert.rejects(runFreeProvider({ provider: 'pollinations', model: 'openai-fast', prompt: 'Say OK', images: [] }), (error: unknown) => {
      assert.ok(error instanceof FreeProviderError);
      assert.equal(error.retryAfterMs, 36_000);
      assert.equal(error.message, 'The free service is rate limiting right now. Try again in 36 seconds, or switch provider.');
      return true;
    });
  } finally {
    delete root.window;
  }
});

test('a long job asks the free cloud model for low reasoning effort, and its errors read as a sentence', async () => {
  // Live in November 2026 the keyless model spent its allowance thinking on a
  // whole listing, and the answer was a long JSON error shown as it came.
  const failure = JSON.stringify({
    success: false,
    error: {
      message: 'The model exhausted its output token limit before producing an answer.',
      code: 'output_token_limit_exceeded',
      details: { name: 'UpstreamError', upstreamHost: 'x'.repeat(400) },
    },
  });
  const sent: Array<Record<string, unknown>> = [];
  const root = globalThis as unknown as { window?: unknown };
  root.window = {
    fetch: async (_url: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body));
      return new Response(failure, { status: 400 });
    },
  };
  try {
    await assert.rejects(runFreeProvider({ provider: 'pollinations', model: 'openai-fast', prompt: 'Proofread this', images: [], effort: 'low' }), (error: unknown) => {
      assert.ok(error instanceof FreeProviderError);
      assert.equal(error.message, 'Pollinations (free cloud) returned an error (400). The model exhausted its output token limit before producing an answer.');
      return true;
    });
    assert.equal(sent[0].reasoning_effort, 'low');
    await assert.rejects(runFreeProvider({ provider: 'pollinations', model: 'openai-fast', prompt: 'Summarise this month', images: [] }));
    assert.equal(sent[1].reasoning_effort, undefined, 'a job that works with figures keeps the default effort');
    await assert.rejects(runFreeProvider({ provider: 'ollama', model: 'llama3.2', prompt: 'Proofread this', images: [], effort: 'low' }));
    assert.equal(sent[2].reasoning_effort, undefined, 'only a provider that takes it gets it');
  } finally {
    delete root.window;
  }
});

test('a sales sync names the first day it read without a gap', () => {
  assert.equal(readSince({}), undefined);
  assert.equal(readSince({ '2026-11-10': 'report', '2026-11-11': 'empty', '2026-11-12': 'report' }), '2026-11-10');
  assert.equal(readSince({ '2026-11-01': 'report', '2026-11-11': 'empty', '2026-11-12': 'report' }), '2026-11-11', 'a gap ends the run');
});

test('kept listing edits follow the listing as it changes', () => {
  const listing = sampleListing();
  const entry = listing.locales[0];
  const changes = [
    { locale: entry.locale, field: 'subtitle' as const, before: 'what it said last week', after: 'Habits that stick' },
    { locale: 'xx-XX', field: 'subtitle' as const, before: '', after: 'a language the listing no longer has' },
    { locale: entry.locale, field: 'keywords' as const, before: 'old', after: entry.keywords },
  ];
  const rebased = rebaseChanges(changes, listing);
  assert.equal(rebased.length, 1, 'gone languages and edits the listing already has are dropped');
  assert.equal(rebased[0].before, entry.subtitle);
  assert.equal(rebased[0].after, 'Habits that stick');
});
