import { gzipSync } from 'node:zlib';
import { generateKeyPairSync } from 'node:crypto';
import { test, expect, type Page } from '../fixtures/test';
import type { TauriHttpRule } from '../fixtures/tauri-runtime';
import { appleShapedKey, openGrowth, putGrowthRows, section } from '../helpers/growth';

// App health on the desktop build: crashes and freezes beside the ratings.
//
// The App Store test syncs against App Store Connect answers shaped like
// Apple's: the App Analytics request's report list (App Crashes, App Sessions
// Standard and the Detailed level that must not be read), daily instances,
// segments and gzipped files on a storage host, with the sessions header Ludo
// Wala's real file had in November 2026, and Xcode's metrics in the shape of
// Apple's documented example. The two Google Play tests check the answer
// Google sends when the reporting API is off (copied from a real one), and
// the screen with Android vitals already stored.

test.skip(({ isDesktop }) => !isDesktop, 'The stores are reached through the desktop shell only');

const APP = '1111111111';
const API = 'https://api\\.appstoreconnect\\.apple\\.com';
const json = (value: unknown) => JSON.stringify(value);

function utcDay(offset: number): string {
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
}
function dayLabel(day: string, withYear = false): string {
  const [y, m, d] = day.split('-');
  const label = `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1]} ${Number(d)}`;
  return withYear || Number(y) !== new Date().getUTCFullYear() ? `${label}, ${y}` : label;
}
function gzipBase64(text: string): string {
  return gzipSync(Buffer.from(text, 'utf8')).toString('base64');
}
const tsv = (rows: string[][]) => rows.map((row) => row.join('\t')).join('\n') + '\n';
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => from + index);

/** A stored rating history, so the rating charts draw: 4.6 stars, slipping after 2.4. */
function ratingHistory(appId: string) {
  const at = Date.now();
  return range(-20, -1).map((offset) => {
    const date = utcDay(offset);
    return { key: `${appId}|${date}`, appId, date, territories: { US: { average: offset < -10 ? 4.6 : 4.4, count: 1200 + (offset + 20) * 5, at: at + offset * 86_400_000 } } };
  });
}

// --- the App Store's files ------------------------------------------------------------------

const SESSIONS_HEADER = ['Date', 'App Name', 'App Apple Identifier', 'App Version', 'Device', 'Platform Version', 'Source Type', 'Page Type', 'App Download Date', 'Territory', 'Sessions', 'Total Session Duration', 'Unique Devices'];
const CRASHES_HEADER = ['Date', 'App Name', 'App Apple Identifier', 'App Version', 'Device', 'Platform Version', 'Crashes', 'Unique Devices'];

/** 2.3 from 24 days ago to 10 days ago, 2.4 from 12 days ago to 2 days ago. */
const SESSIONS = tsv([
  SESSIONS_HEADER,
  ...range(-24, -10).map((offset) => [utcDay(offset), 'Pebble Notes', APP, '2.3', 'iPhone', 'iOS 26.0', 'Unavailable', 'No page', '', 'US', offset <= -13 ? '300' : '50', '9000', '40']),
  ...range(-12, -2).map((offset) => [utcDay(offset), 'Pebble Notes', APP, '2.4', 'iPhone', 'iOS 26.1', 'Unavailable', 'No page', '', 'US', '400', '12000', '60']),
]);
/** 6 crashes on 2.3 in 3,750 sessions, 33 on 2.4 in 4,400: 1.6 and 7.5 per 1,000. */
const CRASHES = tsv([
  CRASHES_HEADER,
  ...[-24, -22, -20, -18, -16, -14].map((offset) => [utcDay(offset), 'Pebble Notes', APP, '2.3', 'iPhone', 'iOS 26.0', '1', '1']),
  ...range(-12, -2).map((offset) => [utcDay(offset), 'Pebble Notes', APP, '2.4', 'iPhone', 'iOS 26.1', '3', '2']),
]);

/** Xcode's metrics in the shape of Apple's documented example; the HANG identifiers are this test's own. */
const HANGS = {
  version: '1.0.0',
  insights: { trendingUp: [{ metricCategory: 'HANG', summaryString: 'Typical (50th percentile) Hang Rate trended up between app versions 2.3 to 2.4 on iPhone (All).' }], regressions: [] },
  productData: [
    {
      platform: 'iOS',
      metricCategories: [
        {
          identifier: 'HANG',
          metrics: [
            {
              identifier: 'hangRate',
              unit: { displayName: 's/hr', identifier: 'secondsPerHour' },
              datasets: [
                { filterCriteria: { device: 'all_iphones', percentile: 'percentile.ninety' }, points: [{ version: '2.3', value: 3.2 }, { version: '2.4', value: 9.8 }] },
                { filterCriteria: { device: 'all_iphones', percentile: 'percentile.fifty' }, points: [{ version: '2.3', value: 0.4 }, { version: '2.4', value: 2.1 }] },
              ],
            },
          ],
        },
      ],
    },
  ],
};

const APPLE_RULES: TauriHttpRule[] = [
  { match: `^GET ${API}/v1/apps\\?`, body: json({ data: [{ type: 'apps', id: APP, attributes: { name: 'Pebble Notes', bundleId: 'com.example.pebble', sku: 'PEBBLE', primaryLocale: 'en-US' } }] }) },
  {
    match: `^GET ${API}/v1/apps/${APP}/customerReviews`,
    body: json({
      data: [
        {
          type: 'customerReviews',
          id: 'review-crash',
          attributes: { rating: 1, title: 'Broken since the update', body: 'It crashes every time I open a note.', reviewerNickname: 'kai', createdDate: `${utcDay(-5)}T09:00:00-07:00`, territory: 'USA' },
          relationships: { response: { data: null } },
        },
        {
          type: 'customerReviews',
          id: 'review-happy',
          attributes: { rating: 5, title: 'Lovely', body: 'Exactly the notes app I wanted.', reviewerNickname: 'mia', createdDate: `${utcDay(-20)}T08:00:00Z`, territory: 'USA' },
          relationships: { response: { data: null } },
        },
      ],
    }),
  },
  // The history is a snapshot, which answers for every day it spans; the ongoing request has sent no daily file yet.
  {
    match: `^GET ${API}/v1/apps/${APP}/analyticsReportRequests`,
    body: json({
      data: [
        { type: 'analyticsReportRequests', id: 'request-ongoing', attributes: { accessType: 'ONGOING', stoppedDueToInactivity: false } },
        { type: 'analyticsReportRequests', id: 'request-snapshot', attributes: { accessType: 'ONE_TIME_SNAPSHOT', stoppedDueToInactivity: false } },
      ],
    }),
  },
  ...(['ongoing', 'snapshot'] as const).map((request) => ({
    match: `^GET ${API}/v1/analyticsReportRequests/request-${request}/reports`,
    body: json({
      data: [
        { type: 'analyticsReports', id: `report-crashes-${request}`, attributes: { name: 'App Crashes', category: 'APP_USAGE' } },
        { type: 'analyticsReports', id: `report-crashes-expanded-${request}`, attributes: { name: 'App Crashes Expanded', category: 'PERFORMANCE' } },
        { type: 'analyticsReports', id: `report-sessions-${request}`, attributes: { name: 'App Sessions Standard', category: 'APP_USAGE' } },
        { type: 'analyticsReports', id: `report-sessions-detail-${request}`, attributes: { name: 'App Sessions Detailed', category: 'APP_USAGE' } },
      ],
    }),
  })),
  ...(['crashes', 'sessions'] as const).flatMap((kind) => [
    { match: `^GET ${API}/v1/analyticsReports/report-${kind}-ongoing/instances`, body: json({ data: [] }) },
    {
      match: `^GET ${API}/v1/analyticsReports/report-${kind}-snapshot/instances`,
      body: json({ data: [{ type: 'analyticsReportInstances', id: `instance-${kind}`, attributes: { granularity: 'DAILY', processingDate: utcDay(-1) } }] }),
    },
    {
      match: `^GET ${API}/v1/analyticsReportInstances/instance-${kind}/segments`,
      body: json({ data: [{ type: 'analyticsReportSegments', id: `segment-${kind}`, attributes: { url: `https://reports.example-storage.com/${kind}.csv.gz?X-Amz-Signature=abc`, sizeInBytes: 900 } }] }),
    },
    {
      match: `^GET https://reports\\.example-storage\\.com/${kind}\\.csv\\.gz`,
      headers: { 'content-type': 'application/octet-stream' },
      bodyBase64: gzipBase64(kind === 'crashes' ? CRASHES : SESSIONS),
    },
  ]),
  { match: `^GET ${API}/v1/apps/${APP}/perfPowerMetrics\\?filter%5BmetricType%5D=HANG$|^GET ${API}/v1/apps/${APP}/perfPowerMetrics\\?filter\\[metricType\\]=HANG$`, headers: { 'content-type': 'application/vnd.apple.xcode-metrics+json' }, body: json(HANGS) },
  {
    match: `^GET https://itunes\\.apple\\.com/lookup\\?id=${APP}&country=us`,
    // 2.4 came out the day its sessions start, so the timeline gets its release.
    body: json({ resultCount: 1, results: [{ kind: 'software', trackName: 'Pebble Notes', version: '2.4', currentVersionReleaseDate: `${utcDay(-12)}T07:00:00Z`, averageUserRating: 4.1, userRatingCount: 1234, screenshotUrls: [], trackViewUrl: `https://apps.apple.com/us/app/pebble-notes/id${APP}` }] }),
  },
];

async function connectApple(page: Page) {
  await page.evaluate((key) => {
    localStorage.setItem('open-screenshot-generator.store-credentials', JSON.stringify({ appstore: { issuerId: '69a6de70-0000-47e3-e053-5b8c7c11a4d1', keyId: 'ABCD123456', privateKey: key } }));
    localStorage.setItem('open-screenshot-generator.growth', JSON.stringify({ historyDays: 30 }));
  }, appleShapedKey());
}

function httpLog(page: Page) {
  return page.evaluate(() => (window as any).__E2E_TAURI__.httpRequests as Array<{ method: string; url: string; headers: Record<string, string> }>);
}

test.describe('app health on the App Store', () => {
  test.use({ tauriConfig: { http: APPLE_RULES } });

  test('a sync reads the crash and session files, and Ratings shows what changed with the newest version beside the ratings', async ({ app, page, tauri }) => {
    await connectApple(page);
    await app.goto();
    await app.dismissStartDialog();
    const view = await openGrowth(page);
    await section(view, 'Setup').click();
    // The ratings sweep runs last, after app health: its line says the sync is over.
    await expect(view.getByText('1,234 ratings in 1 country')).toBeVisible({ timeout: 90_000 });
    const healthRow = view.locator('li').filter({ hasText: 'Crashes and freezes' });
    // A snapshot answers for every day up to its processing date (instanceDays).
    await expect(healthRow).toContainText(`Crash numbers up to ${dayLabel(utcDay(-1), true)}`);

    await section(view, 'Ratings').click();
    // The one sentence first: crashes per 1,000 sessions on the newest version against the one before.
    const finding = view.getByTestId('growth-health-finding');
    await expect(finding).toContainText('Crashes went up with version 2.4');
    await expect(finding).toContainText('7.5 per 1,000 sessions on 2.4, up from 1.6 per 1,000 on 2.3.');
    await expect(finding).toContainText(`1 review since ${dayLabel(utcDay(-12))} mentions crashes.`);

    // On the same timeline as the ratings, by day.
    const timeline = view.getByTestId('growth-health-timeline');
    await expect(timeline.getByRole('img', { name: 'Crashes per 1,000 sessions per day' })).toBeVisible();
    await expect(timeline).toContainText('Reviews that mention crashes');

    // Every version, newest first, with its rate against the one before and Xcode's hang rate.
    const table = view.getByTestId('growth-health-versions');
    const newest = table.locator('tr[data-version="2.4"]');
    await expect(newest).toContainText('Newest');
    // Its release day from the App Store; 2.3 came out before Growth looked, so it has the days Apple counted it.
    await expect(newest).toContainText(`Released ${dayLabel(utcDay(-12))}`);
    await expect(table.locator('tr[data-version="2.3"]')).toContainText(`Seen ${dayLabel(utcDay(-24))} to ${dayLabel(utcDay(-10))}`);
    await expect(newest).toContainText('7.5 per 1,000');
    await expect(newest).toContainText('4.7 times the one before');
    await expect(newest).toContainText('2.1 s/hr');
    await expect(table.locator('tr[data-version="2.3"]')).toContainText('1.6 per 1,000');
    await expect(table.locator('tr[data-version="2.3"]')).toContainText('0.4 s/hr');

    // Picking 2.4 shades its days on the charts, from the card or the table.
    await finding.getByRole('button', { name: 'Show 2.4 on the charts' }).click();
    await expect(finding.getByRole('button', { name: 'Hide 2.4 on the charts' })).toHaveAttribute('aria-pressed', 'true');
    await expect(newest).toHaveAttribute('aria-selected', 'true');
    await expect(timeline.locator('.recharts-reference-area')).toHaveCount(1);
    await newest.getByRole('button', { name: 'Hide version 2.4 on the charts' }).click();
    await expect(timeline.locator('.recharts-reference-area')).toHaveCount(0);

    // The reviews behind the sentence, and only those.
    await finding.getByRole('button', { name: 'Read the 1 review' }).click();
    await expect(view.getByText('It crashes every time I open a note.')).toBeVisible();
    await expect(view.getByText('Exactly the notes app I wanted.')).toHaveCount(0);

    // What went out: the two files, read without Apple's token, the Detailed level never, and the hang rate in Xcode's format.
    const requests = await httpLog(page);
    const files = requests.filter((request) => request.url.startsWith('https://reports.example-storage.com/'));
    expect(files.map((request) => new URL(request.url).pathname).sort()).toEqual(['/crashes.csv.gz', '/sessions.csv.gz']);
    for (const request of files) expect(request.headers.authorization).toBeUndefined();
    expect(requests.some((request) => request.url.includes('report-sessions-detail') || request.url.includes('report-crashes-expanded'))).toBe(false);
    const hangs = requests.find((request) => request.url.includes('/perfPowerMetrics'));
    expect(hangs?.headers.accept).toBe('application/vnd.apple.xcode-metrics+json');
    expect(await tauri.unhandled()).toEqual([]);
  });
});

// --- Google Play ---------------------------------------------------------------------------

const PACKAGE = 'com.example.pebble';
const PLAY_APP = `play:${PACKAGE}`;
const ACTIVATION = 'https://console.developers.google.com/apis/api/playdeveloperreporting.googleapis.com/overview?project=123456789012';
const SERVICE_ACCOUNT = JSON.stringify({
  type: 'service_account',
  project_id: 'pebble-play',
  client_email: 'growth@pebble-play.iam.gserviceaccount.com',
  private_key: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  token_uri: 'https://oauth2.googleapis.com/token',
});
const PLAY_API = `https://androidpublisher\\.googleapis\\.com/androidpublisher/v3/applications/${PACKAGE.replace(/\./g, '\\.')}`;
const now = Math.floor(Date.now() / 1000);

/** What Google answered the test account's key on 2026-11-16, before the API was turned on, with a made-up project number. */
const DISABLED = json({
  error: {
    code: 403,
    message:
      'Google Play Developer Reporting API has not been used in project 123456789012 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/playdeveloperreporting.googleapis.com/overview?project=123456789012 then retry. If you enabled this API recently, wait a few minutes for the action to propagate to our systems and retry.',
    status: 'PERMISSION_DENIED',
    details: [
      {
        '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
        reason: 'SERVICE_DISABLED',
        domain: 'googleapis.com',
        metadata: { consumer: 'projects/123456789012', serviceTitle: 'Google Play Developer Reporting API', service: 'playdeveloperreporting.googleapis.com', containerInfo: '123456789012', activationUrl: ACTIVATION },
      },
    ],
  },
});

const PLAY_RULES: TauriHttpRule[] = [
  { match: '^POST https://oauth2\\.googleapis\\.com/token$', body: json({ access_token: 'ya29.test-token', expires_in: 3600, token_type: 'Bearer' }) },
  {
    match: `^GET ${PLAY_API}/reviews\\?`,
    body: json({
      reviews: [
        {
          reviewId: 'gp:crash-1',
          authorName: 'Kai',
          comments: [{ userComment: { text: 'Keeps closing\tThe app crashes when I open a list.', starRating: 1, lastModified: { seconds: String(now - 3600) }, reviewerLanguage: 'en_GB', appVersionName: '2.4' } }],
        },
      ],
      tokenPagination: {},
    }),
  },
  { match: '^GET https://playdeveloperreporting\\.googleapis\\.com/v1beta1/apps/com\\.example\\.pebble/crashRateMetricSet$', status: 403, body: DISABLED },
];

async function connectPlay(page: Page) {
  await page.evaluate(
    ({ serviceAccountJson, packageName }) => {
      localStorage.setItem('open-screenshot-generator.store-credentials', JSON.stringify({ playstore: { serviceAccountJson, packageName } }));
      localStorage.setItem('open-screenshot-generator.growth', JSON.stringify({ historyDays: 30 }));
    },
    { serviceAccountJson: SERVICE_ACCOUNT, packageName: PACKAGE }
  );
}

test.describe('app health on Google Play, with no ratings or reviews yet', () => {
  test.use({ tauriConfig: { http: [PLAY_RULES[0], { match: `^GET ${PLAY_API}/reviews\\?`, body: json({ reviews: [], tokenPagination: {} }) }, PLAY_RULES[2]] } });

  test('Ratings says there are none, and still says what crash numbers need, with the button', async ({ app, page, tauri }) => {
    await connectPlay(page);
    await app.goto();
    await app.dismissStartDialog();
    const view = await openGrowth(page);
    await section(view, 'Setup').click();
    await expect(view.locator('li').filter({ hasText: 'Crashes and freezes' })).toContainText('Not set up yet', { timeout: 90_000 });
    await section(view, 'Ratings').click();
    await expect(view.getByText('No ratings yet')).toBeVisible();
    const status = view.getByTestId('growth-health-status');
    await expect(status).toContainText('Turn on the Google Play Developer Reporting API');
    await status.getByRole('button', { name: 'Turn on the API' }).click();
    await expect.poll(() => tauri.openedUrls()).toEqual([ACTIVATION]);
  });
});

test.describe('app health on Google Play', () => {
  test.use({ tauriConfig: { http: PLAY_RULES } });

  test('with the reporting API off, Setup and Ratings say so, and the button opens the page that turns it on', async ({ app, page, tauri }) => {
    await connectPlay(page);
    await app.goto();
    await app.dismissStartDialog();
    const view = await openGrowth(page);
    await section(view, 'Setup').click();
    const healthRow = view.locator('li').filter({ hasText: 'Crashes and freezes' });
    await expect(healthRow).toContainText('Not set up yet', { timeout: 90_000 });
    await expect(healthRow).toContainText('Turn on the Google Play Developer Reporting API for the Cloud project of your service account');
    await healthRow.getByRole('button', { name: 'Turn on the API' }).click();
    await expect.poll(() => tauri.openedUrls()).toEqual([ACTIVATION]);

    await section(view, 'Ratings').click();
    const waits = view.getByTestId('growth-health-waits');
    await expect(waits).toContainText('Turn on the Google Play Developer Reporting API');
    await expect(waits.getByRole('button', { name: 'Turn on the API' })).toBeVisible();
    // The review that mentions crashes still shows under the timeline, and its version in the table.
    await expect(view.getByTestId('growth-health-timeline')).toContainText('1 review');
    await expect(view.getByTestId('growth-health-versions').getByRole('button', { name: 'Read the 1 review about crashes on 2.4' })).toBeVisible();
  });

  test("with vitals stored, a version over Google's line is the first thing said, with its freezes and its build", async ({ app, page }) => {
    await connectPlay(page);
    await app.goto();
    await app.dismissStartDialog();
    // Three builds as healthSync.ts stores them: 2.3 at 0.4% of users, 2.4 at 1.6%, a test build on one day, and every build together.
    const days: Record<string, Record<string, Record<string, number>>> = {};
    for (const offset of range(-20, -11)) days[utcDay(offset)] = { '157': { users: 1000, crashRate: 0.004, anrUsers: 1000, anrRate: 0.001 }, '*': { users: 1000, crashRate: 0.004, anrUsers: 1000, anrRate: 0.001 } };
    for (const offset of range(-10, -3)) days[utcDay(offset)] = { '158': { users: 800, crashRate: 0.016, anrUsers: 800, anrRate: 0.002 }, '*': { users: 800, crashRate: 0.016, anrUsers: 800, anrRate: 0.002 } };
    days[utcDay(-6)]['159'] = { users: 50, crashRate: 0, anrUsers: 50, anrRate: 0 };
    await putGrowthRows(page, {
      meta: [
        {
          key: `health:${PLAY_APP}`,
          // Release names as Play Console has them: its own for 157, one the developer typed for 158 (Ludo Wala's build 205 is "New help form").
          value: { appId: PLAY_APP, store: 'playstore', days, releaseNames: { '157': '157 (2.3)', '158': 'Faster lists' }, through: utcDay(-3), readAt: Date.now() },
        },
        // Synced a moment ago, so opening Growth reads what is stored and asks Google nothing.
        { key: `sync:last:${PLAY_APP}`, value: Date.now() },
      ],
      reviews: [
        {
          id: 'gp:crash-1',
          appId: PLAY_APP,
          rating: 1,
          title: 'Keeps closing',
          body: 'The app crashes when I open a list.',
          nickname: 'Kai',
          createdDate: `${utcDay(-4)}T10:00:00Z`,
          territory: '',
          language: 'en-GB',
          appVersion: '2.4',
          appBuild: '158',
        },
      ],
      ratingDays: ratingHistory(PLAY_APP),
    });
    await app.goto();
    await app.dismissStartDialog();
    const view = await openGrowth(page);
    await section(view, 'Ratings').click();

    const finding = view.getByTestId('growth-health-finding');
    await expect(finding).toContainText("Version 2.4 is over Google's line for crashes");
    await expect(finding).toContainText('1.6% of people using 2.4 had a crash, up from 0.4% on 2.3, 4 times as many.');
    await expect(finding).toContainText("Google's line is 1.09%; above it, Google Play can show your app to fewer people.");

    const timeline = view.getByTestId('growth-health-timeline');
    await expect(timeline.getByRole('img', { name: 'People with a crash or a freeze per day' })).toBeVisible();
    await expect(timeline.getByRole('list', { name: 'Legend' })).toContainText("Google's lines");

    const table = view.getByTestId('growth-health-versions');
    // Newest by build number; the review's build joins it to the build's numbers, named by the review, with the typed release name beside it.
    await expect(table.locator('tbody tr')).toHaveCount(3);
    await expect(table.locator('tbody tr').first()).toHaveAttribute('data-version', 'Build 159');
    await expect(table.locator('tbody tr').first()).toContainText('Newest');
    const newest = table.locator('tr[data-version="2.4"]');
    await expect(newest).toContainText('build 158, "Faster lists" in Play Console');
    await expect(newest).toContainText('1 review, 1.0 stars');
    await expect(newest).toContainText(`Seen ${dayLabel(utcDay(-10))} to ${dayLabel(utcDay(-3))}`);
    await expect(newest).toContainText('1.6%');
    await expect(newest).toContainText("Over Google's line");
    await expect(newest).toContainText('0.2%');
    await expect(newest.getByRole('button', { name: 'Read the 1 review about crashes on 2.4' })).toBeVisible();
    const older = table.locator('tr[data-version="2.3"]');
    await expect(older).toContainText('0.4%');
    await expect(older).toContainText('build 157');
    await expect(older).not.toContainText('in Play Console');

    // A build seen on one day still shades a whole day on the line charts.
    await table.getByRole('button', { name: 'Show build 159 on the charts' }).click();
    const shade = timeline.locator('.recharts-reference-area rect');
    await expect(shade).toHaveCount(1);
    expect(Number(await shade.getAttribute('width'))).toBeGreaterThan(10);
    // Named once there: by its line, the day's shade being too narrow for a second label.
    await expect(timeline.locator('svg text').filter({ hasText: /^Build 159$/ })).toHaveCount(1);
    // The average rating and the number of ratings, both line charts, shade it too.
    const ratingShades = view.getByTestId('growth-ratings').locator('.recharts-reference-area rect');
    await expect(ratingShades).toHaveCount(3);
    for (const width of await ratingShades.evaluateAll((rects) => rects.map((rect) => Number(rect.getAttribute('width'))))) expect(width).toBeGreaterThan(10);

    // The last 7 days by month is one bucket, which a line chart puts on one point: the bucket is the whole chart, and so
    // is the shade. In a month's first six days it is two buckets and the shade half the chart; the unit test pins one bucket.
    await view.getByRole('combobox', { name: 'Date range' }).click();
    await page.getByRole('option', { name: 'Last 7 days' }).click();
    await view.getByRole('group', { name: 'Group by' }).getByRole('button', { name: 'Months' }).click();
    await expect(ratingShades).toHaveCount(3);
    for (const width of await ratingShades.evaluateAll((rects) => rects.map((rect) => Number(rect.getAttribute('width'))))) expect(width).toBeGreaterThan(300);
  });
});
