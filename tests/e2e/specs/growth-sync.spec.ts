import { gzipSync } from 'node:zlib';
import { test, expect, type Page } from '../fixtures/test';
import type { TauriHttpRule } from '../fixtures/tauri-runtime';
import type { TauriHarness } from '../fixtures/tauri';
import { appleShapedKey, backToEditor, openGrowth, section, viewButton, views, GROWTH_BUTTON } from '../helpers/growth';

// A whole Growth sync on the desktop build, against App Store Connect answers
// shaped like Apple's documentation: the apps, the listing, reviews and their
// replies, a gzipped Sales and Trends report, the analytics report chain
// (requests, reports, instances, segments, gzipped files on a storage host)
// and the public lookup. tauri-plugin-http is answered by the harness, so the
// app's real transport code runs and nothing leaves the machine.

test.skip(({ isDesktop }) => !isDesktop, 'App Store Connect is reached through the desktop shell only');

const APP = '1111111111';
const API = 'https://api\\.appstoreconnect\\.apple\\.com';

function utcDay(offset: number): string {
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
}

/** The day every feed reports, three days back so it is inside every window. */
const DAY = utcDay(-3);
const [Y, M, D] = DAY.split('-');
const US_DAY = `${M}/${D}/${Y}`;

// Shaped like Apple's .p8, curve parameters and all: WebKit refuses to
// import that shape as it stands, and a key Node wrote would hide it.
const PRIVATE_KEY = appleShapedKey();

function gzipBase64(text: string): string {
  return gzipSync(Buffer.from(text, 'utf8')).toString('base64');
}

function tsv(rows: string[][]): string {
  return rows.map((row) => row.join('\t')).join('\n') + '\n';
}

const SALES = tsv([
  ['Provider', 'Provider Country', 'SKU', 'Developer', 'Title', 'Version', 'Product Type Identifier', 'Units', 'Developer Proceeds', 'Begin Date', 'End Date', 'Customer Currency', 'Country Code', 'Currency of Proceeds', 'Apple Identifier', 'Customer Price', 'Promo Code', 'Parent Identifier'],
  ['APPLE', 'US', 'PEBBLE', 'Pebble Co', 'Pebble Notes', '3.0', '1F', '38', '0', US_DAY, US_DAY, 'USD', 'US', 'USD', APP, '0', '', ''],
  ['APPLE', 'US', 'PEBBLE', 'Pebble Co', 'Pebble Notes', '3.0', '7F', '120', '0', US_DAY, US_DAY, 'USD', 'US', 'USD', APP, '0', '', ''],
  ['APPLE', 'US', 'PEBBLE_PRO', 'Pebble Co', 'Pebble Pro', '', 'IAY', '2', '9.99', US_DAY, US_DAY, 'USD', 'US', 'USD', '2222222222', '12.99', '', 'PEBBLE'],
]);

const ENGAGEMENT = tsv([
  ['Date', 'App Name', 'App Apple Identifier', 'Event', 'Page Type', 'Source Type', 'Engagement Type', 'Device', 'Platform Version', 'Territory', 'Counts', 'Unique Counts'],
  [DAY, 'Pebble Notes', APP, 'Impression', 'No page', 'App Store search', '', 'iPhone', 'iOS 19.1', 'US', '1000', '800'],
  [DAY, 'Pebble Notes', APP, 'Impression', 'No page', 'App Store browse', '', 'iPhone', 'iOS 19.1', 'DE', '500', '400'],
  [DAY, 'Pebble Notes', APP, 'Page view', 'Product page', 'App Store search', '', 'iPhone', 'iOS 19.1', 'US', '120', '100'],
]);

const DOWNLOADS = tsv([
  ['Date', 'App Name', 'App Apple Identifier', 'Download Type', 'App Version', 'Device', 'Platform Version', 'Source Type', 'Page Type', 'Pre-Order', 'Territory', 'Counts'],
  [DAY, 'Pebble Notes', APP, 'First-time download', '3.0', 'iPhone', 'iOS 19.1', 'App Store search', 'Product page', 'No', 'US', '30'],
  [DAY, 'Pebble Notes', APP, 'First-time download', '3.0', 'iPhone', 'iOS 19.1', 'App Store search', 'No Page', 'No', 'US', '10'],
  [DAY, 'Pebble Notes', APP, 'Redownload', '3.0', 'iPad', 'iPadOS 19.1', 'Web referrer', 'Product page', 'No', 'DE', '5'],
]);

const json = (value: unknown) => JSON.stringify(value);

const RULES: TauriHttpRule[] = [
  {
    match: `^GET ${API}/v1/apps\\?`,
    body: json({ data: [{ type: 'apps', id: APP, attributes: { name: 'Pebble Notes', bundleId: 'com.example.pebble', sku: 'PEBBLE', primaryLocale: 'en-US' } }] }),
  },
  {
    match: `^GET ${API}/v1/apps/${APP}/appStoreVersions`,
    body: json({
      data: [
        { type: 'appStoreVersions', id: 'version-31', attributes: { versionString: '3.1', appStoreState: 'PREPARE_FOR_SUBMISSION', platform: 'IOS', createdDate: '2026-11-01T10:00:00-08:00' } },
        { type: 'appStoreVersions', id: 'version-30', attributes: { versionString: '3.0', appStoreState: 'READY_FOR_SALE', platform: 'IOS', createdDate: '2026-10-01T10:00:00-08:00' } },
      ],
    }),
  },
  {
    match: `^GET ${API}/v1/appStoreVersions/version-31/appStoreVersionLocalizations`,
    body: json({
      data: [
        {
          type: 'appStoreVersionLocalizations',
          id: 'loc-en',
          attributes: { locale: 'en-US', description: 'Pebble keeps your notes in one calm place.', keywords: 'notes, notes,journal,memo', promotionalText: '', whatsNew: 'Bug fixes.' },
        },
      ],
    }),
  },
  { match: `^GET ${API}/v1/apps/${APP}/appInfos`, body: json({ data: [{ type: 'appInfos', id: 'info-1', attributes: { state: 'PREPARE_FOR_SUBMISSION' } }] }) },
  {
    match: `^GET ${API}/v1/appInfos/info-1/appInfoLocalizations`,
    body: json({ data: [{ type: 'appInfoLocalizations', id: 'info-loc-en', attributes: { locale: 'en-US', name: 'Pebble Notes', subtitle: 'Calm notes and lists' } }] }),
  },
  {
    match: `^GET ${API}/v1/appStoreVersionLocalizations/loc-en/appScreenshotSets`,
    body: json({
      data: [
        {
          type: 'appScreenshotSets',
          id: 'set-1',
          attributes: { screenshotDisplayType: 'APP_IPHONE_67' },
          relationships: { appScreenshots: { data: [{ type: 'appScreenshots', id: 'shot-1' }], meta: { paging: { total: 5 } } } },
        },
      ],
    }),
  },
  {
    match: `^GET ${API}/v1/apps/${APP}/customerReviews`,
    body: json({
      data: [
        {
          type: 'customerReviews',
          id: 'review-1',
          attributes: { rating: 1, title: 'Lost my notes', body: 'The sync deleted a week of notes.', reviewerNickname: 'kai', createdDate: `${DAY}T09:00:00-07:00`, territory: 'USA' },
          relationships: { response: { data: null } },
        },
        {
          type: 'customerReviews',
          id: 'review-2',
          attributes: { rating: 5, title: 'Lovely', body: 'Exactly the notes app I wanted.', reviewerNickname: 'mia', createdDate: `${DAY}T08:00:00+01:00`, territory: 'DEU' },
          relationships: { response: { data: { type: 'customerReviewResponses', id: 'response-2' } } },
        },
      ],
      included: [
        { type: 'customerReviewResponses', id: 'response-2', attributes: { responseBody: 'Thank you, Mia.', lastModifiedDate: `${DAY}T12:00:00Z`, state: 'PUBLISHED' } },
      ],
    }),
  },
  {
    match: `^POST ${API}/v1/customerReviewResponses$`,
    status: 201,
    body: json({ data: { type: 'customerReviewResponses', id: 'response-1', attributes: { responseBody: 'Sorry about that. Version 3.1 fixes the sync.', lastModifiedDate: new Date().toISOString(), state: 'PENDING_PUBLISH' } } }),
  },
  {
    match: `^GET ${API}/v1/salesReports\\?.*reportDate%5D=${DAY}`,
    headers: { 'content-type': 'application/a-gzip' },
    bodyBase64: gzipBase64(SALES),
  },
  {
    match: `^GET ${API}/v1/apps/${APP}/analyticsReportRequests`,
    body: json({
      data: [
        { type: 'analyticsReportRequests', id: 'request-ongoing', attributes: { accessType: 'ONGOING', stoppedDueToInactivity: false } },
        { type: 'analyticsReportRequests', id: 'request-snapshot', attributes: { accessType: 'ONE_TIME_SNAPSHOT', stoppedDueToInactivity: false } },
      ],
    }),
  },
  {
    match: `^GET ${API}/v1/analyticsReportRequests/request-ongoing/reports`,
    body: json({
      data: [
        { type: 'analyticsReports', id: 'report-engagement', attributes: { name: 'App Store Discovery and Engagement Standard', category: 'APP_STORE_ENGAGEMENT' } },
        { type: 'analyticsReports', id: 'report-engagement-detail', attributes: { name: 'App Store Discovery and Engagement Detailed', category: 'APP_STORE_ENGAGEMENT' } },
        { type: 'analyticsReports', id: 'report-downloads', attributes: { name: 'App Downloads Standard', category: 'APP_STORE_COMMERCE' } },
        { type: 'analyticsReports', id: 'report-crashes', attributes: { name: 'App Crashes Expanded', category: 'PERFORMANCE' } },
      ],
    }),
  },
  { match: `^GET ${API}/v1/analyticsReportRequests/request-snapshot/reports`, body: json({ data: [] }) },
  {
    match: `^GET ${API}/v1/analyticsReports/report-engagement/instances`,
    body: json({ data: [{ type: 'analyticsReportInstances', id: 'instance-engagement', attributes: { granularity: 'DAILY', processingDate: DAY } }] }),
  },
  {
    match: `^GET ${API}/v1/analyticsReports/report-downloads/instances`,
    body: json({ data: [{ type: 'analyticsReportInstances', id: 'instance-downloads', attributes: { granularity: 'DAILY', processingDate: DAY } }] }),
  },
  {
    match: `^GET ${API}/v1/analyticsReportInstances/instance-engagement/segments`,
    body: json({ data: [{ type: 'analyticsReportSegments', id: 'segment-1', attributes: { url: 'https://reports.example-storage.com/engagement.csv.gz?X-Amz-Signature=abc', sizeInBytes: 200 } }] }),
  },
  {
    match: `^GET ${API}/v1/analyticsReportInstances/instance-downloads/segments`,
    body: json({ data: [{ type: 'analyticsReportSegments', id: 'segment-2', attributes: { url: 'https://reports.example-storage.com/downloads.csv.gz?X-Amz-Signature=def', sizeInBytes: 200 } }] }),
  },
  { match: '^GET https://reports\\.example-storage\\.com/engagement\\.csv\\.gz', headers: { 'content-type': 'application/octet-stream' }, bodyBase64: gzipBase64(ENGAGEMENT) },
  { match: '^GET https://reports\\.example-storage\\.com/downloads\\.csv\\.gz', headers: { 'content-type': 'application/octet-stream' }, bodyBase64: gzipBase64(DOWNLOADS) },
  {
    match: `^GET https://itunes\\.apple\\.com/lookup\\?id=${APP}&country=us`,
    body: json({
      resultCount: 1,
      results: [
        {
          kind: 'software',
          trackName: 'Pebble Notes',
          version: '3.0',
          currentVersionReleaseDate: '2026-10-20T07:00:00Z',
          averageUserRating: 4.7,
          userRatingCount: 1234,
          screenshotUrls: [],
          trackViewUrl: 'https://apps.apple.com/us/app/pebble-notes/id1111111111',
        },
      ],
    }),
  },
];

test.use({ tauriConfig: { http: RULES } });

async function connect(page: Page) {
  await page.evaluate(
    ({ key }) => {
      localStorage.setItem(
        'open-screenshot-generator.store-credentials',
        JSON.stringify({ appstore: { issuerId: '69a6de70-0000-47e3-e053-5b8c7c11a4d1', keyId: 'ABCD123456', privateKey: key } })
      );
      localStorage.setItem('open-screenshot-generator.growth', JSON.stringify({ vendorNumber: '85012345', historyDays: 30 }));
    },
    { key: PRIVATE_KEY }
  );
}

/** Open Growth and wait for the first sync, whose last feed is the ratings sweep. */
async function syncOnce(page: Page) {
  const view = await openGrowth(page);
  await section(view, 'Connection').click();
  await expect(view.getByText('1,234 ratings in 1 storefront')).toBeVisible({ timeout: 90_000 });
  return view;
}

let mcpCalls = 0;

/** One tools/call through the desktop bridge, as Rust relays it (see claude-agent.spec.ts). */
async function mcpCall(tauri: TauriHarness, name: string, args: Record<string, unknown>, agent: boolean) {
  const id = ++mcpCalls;
  const callId = `growth-call-${id}`;
  await tauri.emitFromBackend('abs-mcp-request', {
    callId,
    nonce: 'e2e-bridge-nonce',
    agent,
    message: { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } },
  });
  const reply = async () => (await tauri.callsTo('abs_mcp_respond')).find((call) => call.args.callId === callId);
  await expect.poll(async () => !!(await reply()), { timeout: 30_000, message: `${name} was never answered` }).toBe(true);
  const response = (await reply())!.args.response as { result?: { isError?: boolean; content?: Array<{ text?: string }> } };
  return { isError: response.result?.isError === true, text: response.result?.content?.[0]?.text ?? '' };
}

test.describe('growth sync', () => {
  test('a sync reads every feed, and each screen shows what Apple sent', async ({ app, page }) => {
    await connect(page);
    await app.goto();
    await app.dismissStartDialog();

    const view = await openGrowth(page);
    await expect(view.getByRole('combobox', { name: 'App' })).toContainText('Pebble Notes');

    // Opening on an app that has never synced starts a sync. The ratings sweep
    // runs last, so its line is the one that says the sync is over.
    await section(view, 'Connection').click();
    await expect(view.getByText('1,234 ratings in 1 storefront')).toBeVisible({ timeout: 90_000 });
    await expect(view.getByRole('button', { name: 'Sync', exact: true })).toBeVisible();
    await expect(view.getByText('Version 3.1, 1 language')).toBeVisible();
    await expect(view.getByText('2 written reviews')).toBeVisible();
    await expect(view.getByText('30 days of sales')).toBeVisible();
    await expect(view.getByText(`Reports processed through ${DAY}`)).toBeVisible();

    await section(view, 'Overview').click();
    // Engagement and downloads come from the analytics files; downloads win over Sales and Trends on a day both report.
    await expect(view.getByRole('button', { name: /^Impressions 1,500/ })).toBeVisible();
    await expect(view.getByRole('button', { name: /^First-time downloads 40/ })).toBeVisible();
    await expect(view.getByRole('button', { name: /^Conversion rate 3\.75%/ })).toBeVisible();
    await expect(view.getByRole('button', { name: /^Proceeds \$19\.98/ })).toBeVisible();

    // The listing came from the version being prepared, joined with its name and subtitle.
    await section(view, 'Listing').click();
    await expect(view.locator('#growth-field-name')).toHaveValue('Pebble Notes');
    await expect(view.getByText('"notes" appears twice in the keywords')).toBeVisible();

    const requests = await page.evaluate(() => (window as any).__E2E_TAURI__.httpRequests as Array<{ method: string; url: string; headers: Record<string, string> }>);
    const toApple = requests.filter((request) => request.url.startsWith('https://api.appstoreconnect.apple.com/'));
    expect(toApple.length).toBeGreaterThan(30);
    for (const request of toApple) expect(request.headers.authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    // The pre-signed storage URLs carry their own signature and never Apple's token.
    const toStorage = requests.filter((request) => request.url.startsWith('https://reports.example-storage.com/'));
    expect(toStorage).toHaveLength(2);
    for (const request of toStorage) expect(request.headers.authorization).toBeUndefined();
    const sales = toApple.find((request) => request.url.includes(`reportDate%5D=${DAY}`));
    expect(sales?.headers.accept).toBe('application/a-gzip');
    expect(sales?.url).toContain('filter%5BvendorNumber%5D=85012345');
  });

  test('a reply goes to Apple with the review it answers', async ({ app, page }) => {
    await connect(page);
    await app.goto();
    await app.dismissStartDialog();
    const view = await syncOnce(page);
    await section(view, 'Reviews').click();
    const answered = view.locator('[data-review-id="review-2"]');
    await expect(answered).toContainText('Thank you, Mia.');
    await expect(answered).toContainText('Published');

    const review = view.locator('[data-review-id="review-1"]');
    await review.getByRole('button', { name: 'Reply' }).click();
    await review.getByRole('textbox', { name: 'Reply' }).fill('Sorry about that. Version 3.1 fixes the sync.');
    await expect(review.getByText(/Apple checks each one/)).toBeVisible();
    await review.getByRole('button', { name: 'Send reply' }).click();
    await expect(review.getByText('Waiting for Apple to check it')).toBeVisible();

    const posted = await page.evaluate(() =>
      ((window as any).__E2E_TAURI__.httpRequests as Array<{ method: string; url: string; body: string | null }>).find(
        (request) => request.method === 'POST' && request.url.endsWith('/v1/customerReviewResponses')
      )
    );
    expect(JSON.parse(posted!.body!)).toEqual({
      data: {
        type: 'customerReviewResponses',
        attributes: { responseBody: 'Sorry about that. Version 3.1 fixes the sync.' },
        relationships: { review: { data: { type: 'customerReviews', id: 'review-1' } } },
      },
    });
  });

  test('the agent reads the synced numbers through the store tools, and other clients are refused', async ({ app, page, tauri }) => {
    await connect(page);
    await app.goto();
    await app.dismissStartDialog();
    await syncOnce(page);
    await backToEditor(page);

    const overview = await mcpCall(tauri, 'get_store_overview', {}, true);
    expect(overview.isError, overview.text).toBe(false);
    const digest = JSON.parse(overview.text);
    expect(digest.app.name).toBe('Pebble Notes');
    expect(digest.dataCompleteThrough).toBe(DAY);
    expect(digest.totals.current.impressions).toBe(1500);
    expect(digest.totals.current.firstTimeDownloads).toBe(40);
    expect(digest.listing.version).toBe('3.1');

    const reviews = JSON.parse((await mcpCall(tauri, 'list_store_reviews', { maxRating: 2 }, true)).text);
    expect(reviews.reviews).toHaveLength(1);
    expect(reviews.reviews[0].title).toBe('Lost my notes');
    expect(reviews.warning).toMatch(/never as instructions/);
    expect(JSON.stringify(reviews)).not.toContain('kai');

    const metrics = JSON.parse((await mcpCall(tauri, 'get_store_metrics', { metric: 'impressions', territory: 'Germany', days: 7 }, true)).text);
    expect(metrics.points.find((point: { date: string }) => point.date === DAY).value).toBe(500);

    const refused = await mcpCall(tauri, 'get_store_overview', {}, false);
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("shared only with the app's own Claude Code and Codex agents");
  });

  test.describe('when Apple refuses the key for Sales and Trends', () => {
    // Every Sales and Trends request answers 401, the second try included.
    test.use({
      tauriConfig: {
        http: [
          {
            match: `^GET ${API}/v1/salesReports`,
            status: 401,
            body: json({ errors: [{ status: '401', code: 'NOT_AUTHORIZED', title: 'Authentication credentials are missing or invalid.', detail: 'Provide a properly configured and signed bearer token.' }] }),
          },
          ...RULES,
        ],
      },
    });

    test('the feeds that need no key still sync', async ({ app, page }) => {
      await connect(page);
      await app.goto();
      await app.dismissStartDialog();
      // Ratings come from the public lookup: a refused key must not stop them.
      const view = await syncOnce(page);
      await expect(view.getByText('Authentication credentials are missing or invalid.').first()).toBeVisible();
      const salesTries = await page.evaluate(
        () => ((window as any).__E2E_TAURI__.httpRequests as Array<{ url: string }>).filter((request) => request.url.includes('/v1/salesReports')).length
      );
      // Each request in flight is tried twice (a fresh token the second time), then the feed stops.
      expect(salesTries).toBeGreaterThanOrEqual(2);
      expect(salesTries).toBeLessThanOrEqual(8);
    });
  });

  test.describe('with two apps on the account', () => {
    // The day with sales waits until the test lets it through, so the first
    // app's Sales and Trends run is still going when the second app syncs.
    test.use({
      tauriConfig: {
        http: [
          {
            match: `^GET ${API}/v1/apps\\?`,
            body: json({
              data: [
                { type: 'apps', id: APP, attributes: { name: 'Pebble Notes', bundleId: 'com.example.pebble', sku: 'PEBBLE', primaryLocale: 'en-US' } },
                { type: 'apps', id: '3333333333', attributes: { name: 'Pebble Sketch', bundleId: 'com.example.sketch', sku: 'SKETCH', primaryLocale: 'en-US' } },
              ],
            }),
          },
          { match: `^GET ${API}/v1/salesReports\\?.*reportDate%5D=${DAY}`, hold: true, headers: { 'content-type': 'application/a-gzip' }, bodyBase64: gzipBase64(SALES) },
          ...RULES,
        ],
      },
    });

    test('Sales and Trends, which covers both, is read once', async ({ app, page }) => {
      await connect(page);
      await app.goto();
      await app.dismissStartDialog();
      const view = await openGrowth(page);
      await expect(view.getByRole('combobox', { name: 'App' })).toContainText('Pebble Notes');

      const requests = () => page.evaluate(() => (window as any).__E2E_TAURI__.httpRequests as Array<{ url: string }>);
      const salesCount = async () => (await requests()).filter((request) => request.url.includes('/v1/salesReports')).length;
      // The first app's run has asked for all 30 days and is waiting on one.
      await expect.poll(salesCount).toBe(30);

      await view.getByRole('combobox', { name: 'App' }).click();
      await page.getByRole('option', { name: 'Pebble Sketch' }).click();
      await expect.poll(async () => (await requests()).some((request) => request.url.includes('/v1/apps/3333333333/appStoreVersions'))).toBe(true);
      await page.waitForTimeout(1500);
      expect(await salesCount(), 'the second app waits for the first run instead of asking again').toBe(30);

      // Let the held days through until both runs end: the second only
      // checks the newest three days again, which Apple may still fill in.
      await expect
        .poll(
          async () => {
            await page.evaluate(() => (window as any).__E2E_TAURI__.releaseHttp());
            return salesCount();
          },
          { timeout: 60_000 }
        )
        .toBe(33);
      await expect(view.getByRole('button', { name: 'Sync', exact: true })).toBeVisible({ timeout: 60_000 });
      await page.evaluate(() => (window as any).__E2E_TAURI__.releaseHttp());
      expect(await salesCount()).toBe(33);
    });
  });

  test.describe('while Apple is still answering an apply', () => {
    // The change to the version's text waits until the test lets it through.
    test.use({
      tauriConfig: {
        http: [
          {
            match: `^PATCH ${API}/v1/appStoreVersionLocalizations/loc-en$`,
            hold: true,
            body: json({ data: { type: 'appStoreVersionLocalizations', id: 'loc-en', attributes: { locale: 'en-US', keywords: 'notes,journal,memo' } } }),
          },
          ...RULES,
        ],
      },
    });

    test('an edit typed in the meantime is kept for the next apply', async ({ app, page }) => {
      await connect(page);
      await app.goto();
      await app.dismissStartDialog();
      const view = await syncOnce(page);
      await section(view, 'Listing').click();

      await view.locator('#growth-field-keywords').fill('notes,journal,memo');
      await view.getByRole('button', { name: 'Apply in App Store Connect' }).click();
      const patches = () =>
        page.evaluate(() => ((window as any).__E2E_TAURI__.httpRequests as Array<{ method: string; body: string | null }>).filter((request) => request.method === 'PATCH'));
      await expect.poll(async () => (await patches()).length).toBe(1);

      // The fields stay editable while Apple answers.
      await view.locator('#growth-field-promotionalText').fill('Now with folders');
      expect(await page.evaluate(() => (window as any).__E2E_TAURI__.releaseHttp())).toBe(1);

      await expect(view.getByText('Applied 1 change in App Store Connect')).toBeVisible();
      await expect(view.locator('#growth-field-promotionalText')).toHaveValue('Now with folders');
      expect(JSON.parse((await patches())[0].body!).data.attributes).toEqual({ keywords: 'notes,journal,memo' });
      // What waits for the next apply is the new edit alone: the applied
      // keywords left the list, the promotional text did not.
      const kept = () =>
        page.evaluate(async (appId) => {
          const open = indexedDB.open('OpenScreenshotGeneratorGrowth');
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            open.onsuccess = () => resolve(open.result);
            open.onerror = () => reject(open.error);
          });
          const request = db.transaction('meta', 'readonly').objectStore('meta').get(`listing:drafts:${appId}`);
          const row = await new Promise<{ value: Array<{ field: string; after: string }> } | undefined>((resolve) => (request.onsuccess = () => resolve(request.result)));
          db.close();
          return row?.value.map((change) => `${change.field}: ${change.after}`);
        }, APP);
      await expect.poll(kept).toEqual(['promotionalText: Now with folders']);
    });
  });

  test('with the editor in front, an app whose numbers got old syncs in the background and its new insights reach the activity bar', async ({ app, page }) => {
    // The monitor's first pass waits a minute and a half; the clock skips it.
    await page.clock.install();
    await connect(page);
    await app.goto();
    await app.dismissStartDialog();
    const view = await syncOnce(page);
    await backToEditor(page);
    await expect(view).toBeHidden();
    const badge = views(page).getByTestId('growth-badge');
    await expect(badge).toBeHidden();

    // Seven hours on, with the insights it has now never seen.
    await page.evaluate(async (appId) => {
      const open = indexedDB.open('OpenScreenshotGeneratorGrowth');
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      const tx = db.transaction('meta', 'readwrite');
      tx.objectStore('meta').put({ key: `sync:last:${appId}`, value: Date.now() - 7 * 3_600_000 });
      tx.objectStore('meta').put({ key: `insights:seen:${appId}`, value: ['seen before this test'] });
      await new Promise((resolve) => (tx.oncomplete = resolve));
      db.close();
    }, APP);
    const requestsSoFar = await page.evaluate(() => ((window as any).__E2E_TAURI__.httpRequests as unknown[]).length);

    // Past the first pass, and past an hour: opening Growth just now noted an
    // automatic attempt, and a sync whose numbers are still old after one
    // waits an hour before it is tried again.
    await page.clock.fastForward('01:01:30');
    await expect(badge).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/^Pebble Notes: (a new insight|\d+ new insights)$/)).toBeVisible();
    const requestsNow = await page.evaluate(() => ((window as any).__E2E_TAURI__.httpRequests as Array<{ url: string }>));
    expect(requestsNow.length, 'the background pass synced the app').toBeGreaterThan(requestsSoFar);
    expect(requestsNow.slice(requestsSoFar).some((request) => request.url.includes('/customerReviews'))).toBe(true);

    // The bar's button opens on the insights, and what Growth shows counts as seen.
    await viewButton(page, GROWTH_BUTTON).click();
    await expect(view).toBeVisible();
    await expect(section(view, 'Insights')).toHaveAttribute('aria-current', 'page');
    await expect(badge).toBeHidden();
  });
});
