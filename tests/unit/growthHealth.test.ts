// App health: reading Apple's App Crashes and App Sessions files (the
// sessions header is the one Ludo Wala's file had in November 2026, the
// crashes one Apple's documentation lists), Google's vitals rows and tracks
// (as Google sent Ludo Wala's on 2026-11-16),
// Xcode's metrics (Apple's documented example), how a file's numbers replace
// what a day had, the rates, the buckets under the ratings, every version,
// what changed, and the words.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_VERSIONS,
  GOOGLE_CRASH_LINE,
  addHealthRows,
  crashChange,
  crashOver,
  crashWords,
  emptyHealth,
  freezeOver,
  freezeWords,
  healthBuckets,
  healthFinding,
  healthReportKind,
  mergeHealth,
  partial,
  parseCrashesReport,
  parseSessionsReport,
  playVersionNames,
  readHangMetrics,
  readVitalsRows,
  releaseNamesOf,
  steady,
  healthTicks,
  timesWords,
  versionHealth,
  versionInReleaseName,
  versionRows,
  type AppHealth,
  type HealthRows,
} from '@/lib/growth/health';
import { today } from '@/lib/growth/dates';
import { disabledApiUrl } from '@/lib/growth/play';
import { instanceDays } from '@/lib/growth/sync';
import { bandArea, releaseLines } from '@/components/open-screenshot-generator/growth/GrowthRatingCharts';
import type { StoreReview } from '@/lib/growth/types';

const APP = '6797975644';

function review(id: string, overrides: Partial<StoreReview> = {}): StoreReview {
  return { id, appId: APP, rating: 5, title: `Title ${id}`, body: `Body of ${id}`, nickname: 'Mia', createdDate: '2026-11-10T10:00:00Z', territory: 'US', ...overrides };
}

const SESSIONS_HEADER =
  'Date\tApp Name\tApp Apple Identifier\tApp Version\tDevice\tPlatform Version\tSource Type\tPage Type\tApp Download Date\tTerritory\tSessions\tTotal Session Duration\tUnique Devices';
const CRASHES_HEADER = 'Date\tApp Name\tApp Apple Identifier\tApp Version\tDevice\tPlatform Version\tCrashes\tUnique Devices';

const tsv = (header: string, rows: string[][]) => [header, ...rows.map((row) => row.join('\t'))].join('\n');

// --- Apple's files ---------------------------------------------------------------------

test('the two reports are known by the names Apple lists them under, and no other', () => {
  assert.equal(healthReportKind('App Crashes'), 'crashes');
  assert.equal(healthReportKind('App Sessions Standard'), 'sessions');
  // The same sessions split finer, devices only, and iOS-only crashes with nothing to divide by.
  for (const name of ['App Sessions Detailed', 'App Sessions Context', 'App Crashes Expanded', 'App HangTracer Usage', 'App Store Downloads Standard']) {
    assert.equal(healthReportKind(name), null, name);
  }
});

test("a sessions file is added up per day and version, over every device, source and country row", () => {
  const rows = parseSessionsReport(
    tsv(SESSIONS_HEADER, [
      ['2026-09-13', 'Ludo Wala', APP, '1.4.55', 'iPhone', 'iOS 26.0', 'App Store search', 'Product page', '', 'US', '7', '9000', '4'],
      ['2026-09-13', 'Ludo Wala', APP, '1.4.55', 'iPad', 'iPadOS 26.0', 'Unavailable', 'No page', '', 'PK', '5', '6882', '2'],
      ['2026-09-13', 'Ludo Wala', APP, '1.4.53', 'iPhone', 'iOS 18.6', 'Unavailable', 'No page', '', 'US', '2', '3173', '1'],
      ['2026-09-14', 'Ludo Wala', APP, '1.4.56', 'iPhone', 'iOS 26.0', 'App Store browse', 'Product page', '2026-09-14', 'US', '1', '25', '1'],
      // Another app's row never counts.
      ['2026-09-14', 'Other', '123', '9.9', 'iPhone', 'iOS 26.0', 'Unavailable', 'No page', '', 'US', '99', '1', '1'],
      // No version: nothing to put it on.
      ['2026-09-14', 'Ludo Wala', APP, '', 'iPhone', 'iOS 26.0', 'Unavailable', 'No page', '', 'US', '3', '1', '1'],
    ]),
    { appId: APP }
  );
  assert.deepEqual(rows.get('2026-09-13')?.get('1.4.55'), { sessions: 12 });
  assert.deepEqual(rows.get('2026-09-13')?.get('1.4.53'), { sessions: 2 });
  assert.deepEqual(rows.get('2026-09-14')?.get('1.4.56'), { sessions: 1 });
  assert.equal(rows.get('2026-09-14')?.has('9.9'), false);
  assert.equal(rows.get('2026-09-14')?.size, 1);
});

test('a crashes file adds up crashes and crashed devices per day and version', () => {
  const rows = parseCrashesReport(
    tsv(CRASHES_HEADER, [
      ['2026-11-03', 'Ludo Wala', APP, '2.4', 'iPhone', 'iOS 26.1', '9', '6'],
      ['2026-11-03', 'Ludo Wala', APP, '2.4', 'iPad', 'iPadOS 26.1', '3', '2'],
      ['2026-11-03', 'Ludo Wala', APP, '2.3', 'iPhone', 'iOS 18.6', '1', '1'],
    ]),
    { appId: APP }
  );
  assert.deepEqual(rows.get('2026-11-03')?.get('2.4'), { crashes: 12, crashDevices: 8 });
  assert.deepEqual(rows.get('2026-11-03')?.get('2.3'), { crashes: 1, crashDevices: 1 });
  assert.equal(parseCrashesReport('Date\tSomething else\n2026-11-03\t1').size, 0, 'a file without the columns says nothing');
});

test('segments of one file add up', () => {
  const into: HealthRows = parseSessionsReport(tsv(SESSIONS_HEADER, [['2026-11-03', 'Ludo Wala', APP, '2.4', 'iPhone', 'iOS 26.1', 'Unavailable', 'No page', '', 'US', '10', '1', '1']]));
  addHealthRows(into, parseSessionsReport(tsv(SESSIONS_HEADER, [['2026-11-03', 'Ludo Wala', APP, '2.4', 'iPad', 'iPadOS 26.1', 'Unavailable', 'No page', '', 'DE', '5', '1', '1']])));
  assert.deepEqual(into.get('2026-11-03')?.get('2.4'), { sessions: 15 });
});

// --- keeping them -----------------------------------------------------------------------

function appleWith(sessions: Record<string, Record<string, number>>, crashes: Record<string, Record<string, number>>, crashDays?: string[]): AppHealth {
  let health = emptyHealth(APP, 'appstore');
  const sessionRows: HealthRows = new Map(Object.entries(sessions).map(([day, versions]) => [day, new Map(Object.entries(versions).map(([v, n]) => [v, { sessions: n }]))]));
  health = mergeHealth(health, 'sessions', sessionRows, Object.keys(sessions));
  const crashRows: HealthRows = new Map(Object.entries(crashes).map(([day, versions]) => [day, new Map(Object.entries(versions).map(([v, n]) => [v, { crashes: n }]))]));
  health = mergeHealth(health, 'crashes', crashRows, crashDays ?? Object.keys(crashes));
  return health;
}

test("a file replaces only its own fields on its days, so reading it twice doubles nothing and the other report's numbers stay", () => {
  const rows: HealthRows = new Map([['2026-11-03', new Map([['2.4', { crashes: 12, crashDevices: 8 }]])]]);
  let health = appleWith({ '2026-11-03': { '2.4': 1000, '2.3': 400 } }, {});
  health = mergeHealth(health, 'crashes', rows, ['2026-11-03']);
  health = mergeHealth(health, 'crashes', rows, ['2026-11-03']);
  assert.deepEqual(health.days['2026-11-03'], { '2.4': { sessions: 1000, crashes: 12, crashDevices: 8 }, '2.3': { sessions: 400 } });
  // A correction for the day replaces the crashes, sessions untouched.
  health = mergeHealth(health, 'crashes', new Map([['2026-11-03', new Map([['2.4', { crashes: 14, crashDevices: 9 }]])]]), ['2026-11-03']);
  assert.deepEqual(health.days['2026-11-03']['2.4'], { sessions: 1000, crashes: 14, crashDevices: 9 });
  assert.deepEqual(health.crashDays, ['2026-11-03']);
  assert.equal(health.through, '2026-11-03');
});

test("on a day a crash file answers for, a version with no crash row had none; on a day no crash file answers for, nothing is known", () => {
  const health = appleWith({ '2026-11-03': { '2.4': 1000 }, '2026-11-04': { '2.4': 1000 } }, { '2026-11-03': {} }, ['2026-11-03']);
  assert.deepEqual(crashOver(health, ['2026-11-03']), { rate: 0, volume: 1000, events: 0, days: 1, coveredDays: 1 });
  assert.deepEqual(crashOver(health, ['2026-11-04']), { rate: null, volume: 0, events: 0, days: 1, coveredDays: 0 });
  // Both days together: only the answered one counts, and the rate says so.
  assert.deepEqual(crashOver(health, ['2026-11-03', '2026-11-04']), { rate: 0, volume: 1000, events: 0, days: 2, coveredDays: 1 });
});

test('an App Store rate over too few of its days is shown as partial and never compared', () => {
  // Apple sends no crash file for a day under its five-people line: crashes on 2 of 4 days with sessions.
  const health = appleWith(
    { '2026-11-01': { '2.4': 500 }, '2026-11-02': { '2.4': 500 }, '2026-11-03': { '2.4': 500 }, '2026-11-04': { '2.4': 500 } },
    { '2026-11-03': { '2.4': 9 }, '2026-11-04': { '2.4': 7 } }
  );
  const rate = crashOver(health, ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'], '2.4');
  assert.deepEqual(rate, { rate: 16 / 1000, volume: 1000, events: 16, days: 4, coveredDays: 2 });
  assert.equal(partial(rate), true);
  assert.equal(steady('appstore', rate), false, 'enough sessions, but half the days');
  // With three of four days it is steady again.
  assert.equal(steady('appstore', { ...rate, coveredDays: 3 }), true);
});

test('a daily crash file with no rows still answers for the day before its processing date, by the analytics rule', () => {
  assert.deepEqual(instanceDays('2026-11-05', false, []), ['2026-11-04']);
});

// --- Apple's rates ----------------------------------------------------------------------

test('the App Store crash rate is crashes over sessions, for every version or one', () => {
  const health = appleWith({ '2026-11-03': { '2.4': 3000, '2.3': 1000 } }, { '2026-11-03': { '2.4': 9, '2.3': 1 } });
  const all = crashOver(health, ['2026-11-03']);
  assert.equal(all.volume, 4000);
  assert.equal(all.events, 10);
  assert.equal(all.rate, 10 / 4000);
  assert.equal(crashOver(health, ['2026-11-03'], '2.4').rate, 9 / 3000);
  assert.equal(freezeOver(health, ['2026-11-03']), null, 'the App Store has no day by day freezes');
  assert.equal(crashWords('appstore', 9 / 3000), '3 per 1,000 sessions');
  assert.equal(crashWords('appstore', 0.00004), 'under 0.1 per 1,000 sessions');
  assert.equal(crashWords('appstore', 0.0123, { short: true }), '12 per 1,000');
});

// --- Google's vitals --------------------------------------------------------------------

/** A vitals row as Google sent Ludo Wala's on 2026-11-16: the build as stringValue, rates as shares with four decimals. */
function vitalsRow(day: string, rate: string, users: string, versionCode?: string, metric = 'userPerceivedCrashRate') {
  const [year, month, date] = day.split('-').map(Number);
  return {
    aggregationPeriod: 'DAILY',
    startTime: { year, month, day: date, timeZone: { id: 'America/Los_Angeles' } },
    ...(versionCode ? { dimensions: [{ dimension: 'versionCode', stringValue: versionCode }] } : {}),
    metrics: [
      { metric, decimalValue: { value: rate } },
      { metric: 'distinctUsers', decimalValue: { value: users } },
    ],
  };
}

test('vitals rows read as a share and its users, per build or for every build', () => {
  const rows = readVitalsRows(
    {
      rows: [
        vitalsRow('2026-11-03', '0.0040', '1000'),
        vitalsRow('2026-11-03', '0.0210', '400', '158'),
        // The discovery document allows int64Value too.
        { ...vitalsRow('2026-11-03', '0.0010', '600'), dimensions: [{ dimension: 'versionCode', int64Value: '157' }] },
        // A row without its users, or with a number that is not one, says nothing.
        { ...vitalsRow('2026-11-04', '0.01', '10', '158'), metrics: [{ metric: 'userPerceivedCrashRate', decimalValue: { value: '0.01' } }] },
        vitalsRow('2026-11-04', 'n/a', '10', '158'),
      ],
    },
    'crash'
  );
  assert.deepEqual(rows.get('2026-11-03')?.get(ALL_VERSIONS), { crashRate: 0.004, users: 1000 });
  assert.deepEqual(rows.get('2026-11-03')?.get('158'), { crashRate: 0.021, users: 400 });
  assert.deepEqual(rows.get('2026-11-03')?.get('157'), { crashRate: 0.001, users: 600 });
  assert.equal(rows.has('2026-11-04'), false);
  const freezes = readVitalsRows({ rows: [vitalsRow('2026-11-03', '0.003', '990', undefined, 'userPerceivedAnrRate')] }, 'anr');
  assert.deepEqual(freezes.get('2026-11-03')?.get(ALL_VERSIONS), { anrRate: 0.003, anrUsers: 990 });
  assert.equal(readVitalsRows({ error: { code: 403 } }, 'crash').size, 0);
});

function playWith(days: Array<[string, string, number, number, number?, number?]>): AppHealth {
  let health = emptyHealth('play:com.example', 'playstore');
  const crash: HealthRows = new Map();
  const anr: HealthRows = new Map();
  for (const [day, version, rate, users, anrRate, anrUsers] of days) {
    addHealthRows(crash, new Map([[day, new Map([[version, { crashRate: rate, users }]])]]));
    if (anrRate !== undefined) addHealthRows(anr, new Map([[day, new Map([[version, { anrRate, anrUsers: anrUsers ?? users }]])]]));
  }
  const covered = [...new Set(days.map(([day]) => day))];
  health = mergeHealth(health, 'crash', crash, covered);
  health = mergeHealth(health, 'anr', anr, covered);
  return health;
}

test("Google Play's rate over days weights each day by its users, as Google's own averages do", () => {
  const health = playWith([
    ['2026-11-03', ALL_VERSIONS, 0.01, 100, 0.002, 100],
    ['2026-11-04', ALL_VERSIONS, 0.02, 300, 0.004, 300],
  ]);
  const crash = crashOver(health, ['2026-11-03', '2026-11-04']);
  assert.equal(crash.volume, 400);
  assert.ok(Math.abs(crash.rate! - (0.01 * 100 + 0.02 * 300) / 400) < 1e-12);
  assert.ok(Math.abs(freezeOver(health, ['2026-11-03', '2026-11-04'])!.rate! - (0.002 * 100 + 0.004 * 300) / 400) < 1e-12);
  assert.equal(crashWords('playstore', 0.0121), '1.21% of users');
  assert.equal(freezeWords(0.0031, { short: true }), '0.31%');
  assert.equal(freezeWords(0.00004), 'under 0.01% of users');
});

test('a build keeps the name of the release that carries it, as typed, production first', () => {
  const names = releaseNamesOf({
    tracks: [
      { track: 'internal', releases: [{ name: 'internal test', versionCodes: ['159'] }, { name: 'ignored', versionCodes: ['158'] }] },
      { track: 'production', releases: [{ name: '2.4', versionCodes: ['158'], status: 'completed' }] },
      { track: 'beta', releases: [{ name: '', versionCodes: ['160'] }] },
    ],
  });
  assert.deepEqual(names, { '158': '2.4', '159': 'internal test' });
  assert.deepEqual(releaseNamesOf(null), {});
});

test("a build's version comes from its reviews, or from a release name that holds it, never from a name the developer typed", () => {
  // Ludo Wala's release names on 2026-11-16.
  assert.equal(versionInReleaseName('New help form', '205'), null);
  assert.equal(versionInReleaseName('Initial release', '120'), null);
  assert.equal(versionInReleaseName('138 (1.3.8)', '138'), '1.3.8', "Play Console's own name: build, then version");
  assert.equal(versionInReleaseName('138 (1.3.8)', '139'), null, 'another build in the same release');
  assert.equal(versionInReleaseName('1.4.65', '205'), '1.4.65');
  assert.equal(versionInReleaseName('v2.0.1', '300'), '2.0.1');
  const names = playVersionNames(
    [
      review('a', { appBuild: '205', appVersion: '1.4.65' }),
      review('b', { appVersion: '1.4.60' }),
      review('c', { appBuild: '138', appVersion: '1.3.8-hotfix' }),
    ],
    { '205': 'New help form', '138': '138 (1.3.8)', '120': 'Initial release' }
  );
  assert.deepEqual(names, { '205': '1.4.65', '138': '1.3.8-hotfix' }, "Google's own pair on a review wins over the release name");
});

test("a SERVICE_DISABLED answer names the page that turns the API on, as Google sent it in November 2026 (project number made up)", () => {
  const body = JSON.stringify({
    error: {
      code: 403,
      message: 'Google Play Developer Reporting API has not been used in project 123456789012 before or it is disabled.',
      status: 'PERMISSION_DENIED',
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
          reason: 'SERVICE_DISABLED',
          domain: 'googleapis.com',
          metadata: {
            consumer: 'projects/123456789012',
            service: 'playdeveloperreporting.googleapis.com',
            activationUrl: 'https://console.developers.google.com/apis/api/playdeveloperreporting.googleapis.com/overview?project=123456789012',
          },
        },
      ],
    },
  });
  assert.equal(disabledApiUrl(403, body), 'https://console.developers.google.com/apis/api/playdeveloperreporting.googleapis.com/overview?project=123456789012');
  assert.equal(disabledApiUrl(403, JSON.stringify({ error: { code: 403, message: 'The caller does not have permission' } })), null, 'a missing permission is another answer');
  assert.equal(disabledApiUrl(404, body), null);
  // A link that is not Google's console is never offered.
  assert.equal(disabledApiUrl(403, body.replace('https://console.developers.google.com', 'https://evil.example')), '');
});

// --- Apple's hang rate ------------------------------------------------------------------

/** Apple's documented example answer of GET /v1/apps/{id}/perfPowerMetrics (launch times), copied 2026-11-16. */
const XCODE_EXAMPLE = {
  version: '1.0.0',
  insights: {
    regressions: [
      {
        latestVersion: '2.0',
        metric: 'launchTime',
        metricCategory: 'LAUNCH',
        summaryString:
          'Top (90th percentile) and typical (50th percentile) Launch Time trended up between app versions 1.0 to 2.0 on iPhone (All). The maximum value for the latest app version is at 2014.30 ms and increased between 10% to 13% compared to the average for previous 4 app versions.',
      },
    ],
    trendingUp: [],
  },
  productData: [
    {
      platform: 'iOS',
      metricCategories: [
        {
          identifier: 'LAUNCH',
          metrics: [
            {
              identifier: 'launchTime',
              unit: { displayName: 'ms', identifier: 'milliseconds' },
              datasets: [
                {
                  filterCriteria: { device: 'all_iphones', deviceMarketingName: 'All iPhones', percentile: 'percentile.ninety' },
                  points: [
                    { value: 1532.1, version: '1.0' },
                    { value: 2014.3, version: '2.0' },
                  ],
                },
                {
                  filterCriteria: { device: 'all_iphones', deviceMarketingName: 'All iPhones', percentile: 'percentile.fifty' },
                  points: [
                    { value: 768.7, version: '1.0' },
                    { value: 750, version: '1.1' },
                    { value: 992.3, version: '1.2' },
                    { value: 1118.9, version: '1.3' },
                    { value: 997.8, version: '2.0' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

test("Xcode's metrics are read by category, the typical iPhone's value per version, in Apple's own unit and words", () => {
  const launch = readHangMetrics(XCODE_EXAMPLE, 'LAUNCH');
  assert.equal(launch?.unit, 'ms');
  assert.deepEqual(launch?.points.map((point) => point.version), ['1.0', '1.1', '1.2', '1.3', '2.0']);
  assert.equal(launch?.points[4].value, 997.8);
  assert.match(launch?.summary ?? '', /^Top \(90th percentile\)/);
  // No HANG category in it, and none on the test account's apps (productData empty).
  assert.equal(readHangMetrics(XCODE_EXAMPLE), null);
  assert.equal(readHangMetrics({ productData: [], insights: { trendingUp: [], regressions: [] }, version: '1.0.0' }), null);
});

// --- over time and by version -----------------------------------------------------------

test('health buckets are the ratings buckets, with the reviews that mention crashing or freezing', () => {
  const health = appleWith({ '2026-11-03': { '2.4': 1000 }, '2026-11-10': { '2.4': 2000 } }, { '2026-11-03': { '2.4': 4 }, '2026-11-10': { '2.4': 2 } });
  const reviews = [
    review('a', { createdDate: '2026-11-04T08:00:00Z', rating: 1, body: 'It keeps crashing on start' }),
    review('b', { createdDate: '2026-11-11T08:00:00Z', rating: 2, body: 'The game freezes after level 3' }),
    review('c', { createdDate: '2026-11-11T09:00:00Z', rating: 5, body: 'Lovely game' }),
  ];
  // Growth's weeks start on a Monday, as the ratings charts' do.
  const buckets = healthBuckets(health, { granularity: 'week', window: { from: '2026-11-02', to: '2026-11-15' }, reviews });
  assert.deepEqual(
    buckets.map((bucket) => [bucket.start, bucket.end, bucket.crash.rate, bucket.crashReviews]),
    [
      ['2026-11-02', '2026-11-08', 4 / 1000, 1],
      ['2026-11-09', '2026-11-15', 2 / 2000, 1],
    ]
  );
});

test('every version, newest first, with its days, its rates and the reviews of its time', () => {
  const health = appleWith(
    { '2026-10-20': { '2.3': 900 }, '2026-11-03': { '2.3': 300, '2.4': 2000 }, '2026-11-04': { '2.4': 2500 } },
    { '2026-10-20': { '2.3': 1 }, '2026-11-03': { '2.3': 0, '2.4': 18 }, '2026-11-04': { '2.4': 20 } }
  );
  const reviews = [
    review('old', { createdDate: '2026-10-25T08:00:00Z', rating: 4, body: 'Fine' }),
    review('new', { createdDate: '2026-11-05T08:00:00Z', rating: 1, body: 'Crashes all the time since the update' }),
  ];
  const versions = versionHealth(health);
  assert.deepEqual(versions.map((entry) => [entry.name, entry.from, entry.to]), [
    ['2.4', '2026-11-03', '2026-11-04'],
    ['2.3', '2026-10-20', '2026-11-03'],
  ]);
  assert.equal(versions[0].crash.rate, 38 / 4500);
  assert.equal(versions[1].crash.rate, 1 / 1200);
  // The App Store says no version on a review: it counts for the version that was newest that day.
  const rows = versionRows('appstore', { versions, reviews });
  assert.deepEqual(rows.map((row) => [row.name, row.crashReviewIds]), [['2.4', ['new']], ['2.3', []]]);
});

test('newest is the highest version, not the one seen last, and a release on the timeline adds its version and its day', () => {
  // Ludo Wala on 2026-11-16: the charts marked 1.4.66, while App Analytics had sessions for 1.4.58 on one day only.
  const versions = versionHealth(appleWith({ '2026-09-18': { '1.4.58': 40 }, '2026-09-02': { '1.4.6': 30 } }, {}));
  assert.deepEqual(versions.map((entry) => entry.name), ['1.4.58', '1.4.6'], '58 is after 6');
  const rows = versionRows('appstore', {
    versions,
    reviews: [],
    releases: [
      { version: '1.4.66', date: '2026-11-10' },
      { version: '1.4.58', date: '2026-09-15' },
    ],
  });
  assert.deepEqual(
    rows.map((row) => [row.name, row.released, row.seen, row.from, row.to]),
    [
      ['1.4.66', '2026-11-10', null, '2026-11-10', today()],
      // Out from its release until the day before the next one came out.
      ['1.4.58', '2026-09-15', { from: '2026-09-18', to: '2026-09-18' }, '2026-09-15', '2026-11-09'],
      // No release Growth saw: its days are the ones Apple counted people using it.
      ['1.4.6', null, { from: '2026-09-02', to: '2026-09-02' }, '2026-09-02', '2026-09-02'],
    ]
  );
});

test("a Google Play build and its reviews are one row, named by the reviews, with a typed release name beside it", () => {
  // Ludo Wala on 2026-11-16: build 205 is 1.4.65, and its production release is called "New help form".
  const health: AppHealth = {
    ...playWith([
      ['2026-10-30', '204', 0.002, 900, 0.001, 900],
      ['2026-11-03', '205', 0.025, 600, 0.002, 600],
      ['2026-11-03', '99', 0.001, 300, 0.001, 300],
    ]),
    releaseNames: { '205': 'New help form', '204': '204 (1.4.64)' },
  };
  const reviews = [
    review('a', { appBuild: '205', appVersion: '1.4.65', rating: 1, body: 'Force closes every time', createdDate: '2026-11-04T00:00:00Z' }),
    // Stored before Growth kept builds: it names the version only.
    review('b', { appVersion: '1.4.65', rating: 3, body: 'ok', createdDate: '2026-11-05T00:00:00Z' }),
    review('c', { appBuild: '206', appVersion: '1.4.66', rating: 5, body: 'Nice', createdDate: '2026-11-15T00:00:00Z' }),
    review('d', { appVersion: '1.2.0', rating: 2, body: 'It crashes', createdDate: '2026-08-01T00:00:00Z' }),
  ];
  const names = playVersionNames(reviews, health.releaseNames);
  const versions = versionHealth(health, names);
  assert.deepEqual(
    versions.map((entry) => [entry.key, entry.name, entry.releaseName]),
    [
      ['205', '1.4.65', 'New help form'],
      ['204', '1.4.64', null],
      // Build numbers compare as numbers: 99 is older than 204.
      ['99', 'Build 99', null],
    ]
  );
  assert.equal(versions[0].freeze!.rate, 0.002);
  const rows = versionRows('playstore', { versions, reviews, names });
  assert.deepEqual(
    rows.map((row) => [row.key, row.name, row.ratings?.count ?? 0, row.crashReviewIds, row.seen]),
    [
      // A build with reviews and no crash numbers yet is newest, seen on its reviews' days.
      ['206', '1.4.66', 1, [], { from: '2026-11-15', to: '2026-11-15' }],
      ['205', '1.4.65', 2, ['a'], { from: '2026-11-03', to: '2026-11-03' }],
      ['204', '1.4.64', 0, [], { from: '2026-10-30', to: '2026-10-30' }],
      ['99', 'Build 99', 0, [], { from: '2026-11-03', to: '2026-11-03' }],
      // Known by name only, from reviews without a build: below every build.
      ['name:1.2.0', '1.2.0', 1, ['d'], { from: '2026-08-01', to: '2026-08-01' }],
    ]
  );
});

test('the versions table also lists versions known from ratings or reviews only, with their reviews about crashes', () => {
  const appleReviews = [
    review('in', { createdDate: '2026-09-10T00:00:00Z', rating: 1, body: 'It crashed twice today' }),
    review('later', { createdDate: '2026-10-10T00:00:00Z', rating: 1, body: 'Crashes since 2.3' }),
  ];
  const apple = versionRows('appstore', {
    versions: [],
    ratingVersions: [
      { version: '2.3', from: '2026-10-01', to: '2026-10-30', newCount: 3, newAverage: 2 },
      { version: '2.2', from: '2026-09-01', to: '2026-09-30', newCount: 12, newAverage: 4.5 },
    ],
    reviews: appleReviews,
  });
  assert.deepEqual(
    apple.map((row) => [row.name, row.health, row.ratings, row.crashReviewIds]),
    [
      ['2.3', null, { count: 3, average: 2, what: 'new ratings' }, ['later']],
      ['2.2', null, { count: 12, average: 4.5, what: 'new ratings' }, ['in']],
    ]
  );
  const play = versionRows('playstore', { versions: [], reviews: [review('a', { appVersion: '2.1', rating: 1, body: 'Force closes on start', createdDate: '2026-08-02T00:00:00Z' })] });
  assert.deepEqual(play.map((row) => [row.name, row.from, row.ratings, row.crashReviewIds]), [['2.1', '2026-08-02', { count: 1, average: 1, what: 'reviews' }, ['a']]]);
});

// --- what changed -----------------------------------------------------------------------

function appleVersions(spec: Array<[string, string, number, number]>) {
  // [version, day, sessions, crashes]
  const sessions: Record<string, Record<string, number>> = {};
  const crashes: Record<string, Record<string, number>> = {};
  for (const [version, day, s, c] of spec) {
    (sessions[day] ??= {})[version] = s;
    (crashes[day] ??= {})[version] = c;
  }
  return versionHealth(appleWith(sessions, crashes));
}

test('a version that crashes 1.5 times as often or more, with steady numbers on both, is worse; the same way down is better', () => {
  const worse = healthFinding('appstore', appleVersions([['2.3', '2026-10-20', 2000, 2], ['2.4', '2026-11-03', 2000, 8]]));
  assert.deepEqual(worse && [worse.kind, worse.measure, worse.version.name, worse.previous.name, worse.before, worse.after], ['worse', 'crash', '2.4', '2.3', 0.001, 0.004]);
  const better = healthFinding('appstore', appleVersions([['2.3', '2026-10-20', 2000, 8], ['2.4', '2026-11-03', 2000, 2]]));
  assert.equal(better?.kind, 'better');
  assert.equal(healthFinding('appstore', appleVersions([['2.3', '2026-10-20', 2000, 4], ['2.4', '2026-11-03', 2000, 5]])), null, 'about the same');
  // Too few sessions to say: 4 crashes in 100 sessions is a jump of noise.
  assert.equal(healthFinding('appstore', appleVersions([['2.3', '2026-10-20', 2000, 1], ['2.4', '2026-11-03', 100, 4]])), null);
  // A thin version in between is passed over for the newest steady one before it.
  const skipped = healthFinding('appstore', appleVersions([['2.2', '2026-10-01', 3000, 3], ['2.3', '2026-10-20', 50, 0], ['2.4', '2026-11-03', 3000, 12]]));
  assert.equal(skipped?.previous.name, '2.2');
});

test("on Google Play, crossing Google's line counts even below 1.5 times", () => {
  const health: AppHealth = {
    ...playWith([
      ['2026-10-20', '157', 0.0095, 5000],
      ['2026-11-03', '158', 0.0112, 5000],
    ]),
    releaseNames: { '157': '2.3', '158': '2.4' },
  };
  const versions = versionHealth(health, playVersionNames([], health.releaseNames));
  const found = healthFinding('playstore', versions);
  assert.deepEqual(found && [found.kind, found.overLine, found.version.name], ['worse', true, '2.4']);
  const rows = versionRows('playstore', { versions, reviews: [] });
  assert.deepEqual(crashChange('playstore', rows, 0)?.kind, 'over-line');
  assert.equal(crashChange('playstore', rows, 1), null, 'the oldest has nothing before it, and is under the line');
  assert.ok(GOOGLE_CRASH_LINE === 0.0109);
});

test('steady needs enough sessions or user days', () => {
  assert.equal(steady('appstore', { rate: 0.01, volume: 199 }), false);
  assert.equal(steady('appstore', { rate: 0.01, volume: 200 }), true);
  assert.equal(steady('playstore', { rate: null, volume: 900 }), false);
  assert.equal(timesWords(0.004, 0.001), '4 times');
  assert.equal(timesWords(0.0018, 0.001), null, 'under about twice, no times');
});

test('the health axis counts in round steps up past the top', () => {
  assert.deepEqual(healthTicks(1.725), [0, 0.5, 1, 1.5, 2], 'not 0.45% and 1.35%');
  assert.deepEqual(healthTicks(9), [0, 2.5, 5, 7.5, 10]);
  assert.deepEqual(healthTicks(1), [0, 0.25, 0.5, 0.75, 1]);
  assert.deepEqual(healthTicks(0.1), [0, 0.025, 0.05, 0.075, 0.1]);
  assert.deepEqual(healthTicks(1.2535), [0, 0.5, 1, 1.5]);
  assert.deepEqual(healthTicks(40), [0, 10, 20, 30, 40]);
  assert.deepEqual(healthTicks(0), [0, 0.25]);
});

test('on a line chart a band covers whole buckets, so one day or one bucket has a width; on a bar chart it is the bars', () => {
  const days = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'].map((day) => ({ start: day, end: day }));
  const one = { from: '2026-11-02', to: '2026-11-02', label: '1.4.58' };
  assert.deepEqual(bandArea(one, days, 'band'), { x1: '2026-11-02', x2: '2026-11-02', first: '2026-11-02', single: true });
  // Drawn from the day before to the day after, half a day cut off each side: one day wide.
  assert.deepEqual(bandArea(one, days, 'point'), { x1: '2026-11-01', x2: '2026-11-03', first: '2026-11-02', single: false, trim: { steps: 2, left: 0.5, right: 0.5 } });
  // At the chart's edge there is no half day to add.
  assert.deepEqual(bandArea({ from: '2026-10-20', to: '2026-11-01', label: '' }, days, 'point'), { x1: '2026-11-01', x2: '2026-11-02', first: '2026-11-01', single: false, trim: { steps: 1, left: 0, right: 0.5 } });
  assert.deepEqual(bandArea({ from: '2026-11-03', to: '2026-12-01', label: '' }, days, 'point'), { x1: '2026-11-02', x2: '2026-11-04', first: '2026-11-03', single: false, trim: { steps: 2, left: 0.5, right: 0 } });
  assert.equal(bandArea({ from: '2026-12-01', to: '2026-12-02', label: '' }, days, 'point'), null);
  // A line chart of one bucket (the last 7 days by month): the bucket is the whole chart, and so is the shade.
  const month = [{ start: '2026-11-01', end: '2026-11-30' }];
  assert.deepEqual(bandArea({ from: '2026-11-04', to: '2026-11-13', label: '1.4.65' }, month, 'point'), { first: '2026-11-01', single: false, trim: { steps: 1, left: 0, right: 0 } });
  assert.deepEqual(bandArea({ from: '2026-11-04', to: '2026-11-13', label: '1.4.65' }, month, 'band'), { x1: '2026-11-01', x2: '2026-11-01', first: '2026-11-01', single: true });
});

test('a release line names its version, and a bucket with more than one release says how many', () => {
  const release = (id: string, date: string, version: string) => ({ id, appId: 'a', date, kind: 'release' as const, title: '', origin: 'auto' as const, version, createdAt: 0 });
  const events = [release('a', '2026-11-06', '2.4'), release('b', '2026-11-10', 'Build 159'), release('c', '2026-11-10', 'Build 159'), release('d', '2026-10-23', '2.3')];
  const days = ['2026-10-23', '2026-11-06', '2026-11-10'].map((day) => ({ start: day, end: day }));
  assert.deepEqual(releaseLines(events, days).map((line) => [line.x, line.label]), [['2026-11-06', '2.4'], ['2026-11-10', 'Build 159'], ['2026-10-23', '2.3']]);
  const months = [{ start: '2026-10-01', end: '2026-10-31' }, { start: '2026-11-01', end: '2026-11-30' }];
  assert.deepEqual(releaseLines(events, months).map((line) => [line.x, line.label]), [['2026-11-01', '2 versions'], ['2026-10-01', '2.3']]);
});
