import { generateKeyPairSync } from 'node:crypto';
import { test, expect, type Page } from '../fixtures/test';
import type { TauriHttpRule } from '../fixtures/tauri-runtime';
import type { TauriHarness } from '../fixtures/tauri';
import { FakeAppStore, playListing, playShot, type PlayListing } from '../helpers/appStore';
import { TEST_ACCOUNT_RULES, TEST_APP, TEST_KEY, backToEditor, openGrowth, section } from '../helpers/growth';

// Growth for a Google Play app on the desktop build, against answers shaped
// like Google's: a service account token, the store page read through an
// edit (opened, read and deleted), the Reviews API, and the monthly report
// files in Cloud Storage, written as Google writes them (UTF-16 with a byte
// order mark) with the headers seen in real buckets. tauri-plugin-http is
// answered by the harness, so nothing leaves the machine.

test.skip(({ isDesktop }) => !isDesktop, 'Google Play is reached through the desktop shell only');

const PACKAGE = 'com.example.pebble';
const APP_ID = `play:${PACKAGE}`;
const BUCKET = 'pubsite_prod_rev_01234567890987654321';

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const API = `https://androidpublisher\\.googleapis\\.com/androidpublisher/v3/applications/${escape(PACKAGE)}`;
const STORAGE = `https://storage\\.googleapis\\.com/storage/v1/b/${BUCKET}`;

function utcDay(offset: number): string {
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
}

/** The day the report files have reached: Google posts each day about a week late. */
const DAY = utcDay(-8);
const MONTH = DAY.slice(0, 7).replace('-', '');

/** A 1x1 PNG, standing in for the images Play Console hands out. */
const PIXEL_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PIXEL = `data:image/png;base64,${PIXEL_BASE64}`;
/** Where Play Console's images live. Its server refuses the web view's own requests, so the app fetches them. */
const IMAGE = (name: string) => `https://lh3.googleusercontent.com/e2e-${name}`;

const PRIVATE_KEY = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const SERVICE_ACCOUNT = JSON.stringify({
  type: 'service_account',
  project_id: 'pebble-play',
  client_email: 'growth@pebble-play.iam.gserviceaccount.com',
  private_key: PRIVATE_KEY,
  token_uri: 'https://oauth2.googleapis.com/token',
});

function cell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** A report file as Google writes it: UTF-16LE with a byte order mark and CRLF line ends. */
function reportFile(rows: string[][]): string {
  const text = rows.map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n';
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]).toString('base64');
}

const FILES: Record<string, string> = {
  [`stats/installs/installs_${PACKAGE}_${MONTH}_country.csv`]: reportFile([
    ['Date', 'Package name', 'Country', 'Daily Device Installs', 'Daily Device Uninstalls', 'Daily Device Upgrades', 'Total User Installs', 'Daily User Installs', 'Daily User Uninstalls', 'Active Device Installs', 'Install events', 'Update events', 'Uninstall events'],
    [DAY, PACKAGE, 'US', '33', '0', '0', '0', '30', '4', '1200', '34', '50', '5'],
    [DAY, PACKAGE, 'DE', '11', '0', '0', '0', '10', '1', '400', '11', '5', '1'],
  ]),
  [`stats/store_performance/store_performance_${PACKAGE}_${MONTH}_country.csv`]: reportFile([
    ['Date', 'Package name', 'Country / region', 'Store listing acquisitions', 'Store listing visitors', 'Store listing conversion rate'],
    [DAY, PACKAGE, 'US', '30', '300', '0.1'],
    [DAY, PACKAGE, 'DE', '10', '100', '0.1'],
  ]),
  [`stats/store_performance/store_performance_${PACKAGE}_${MONTH}_traffic_source.csv`]: reportFile([
    ['Date', 'Package name', 'Traffic source', 'Search term', 'UTM source', 'UTM campaign', 'Store listing acquisitions', 'Store listing visitors', 'Store listing conversion rate'],
    [DAY, PACKAGE, 'Google Play search', 'notes', 'No UTM source specified', 'No UTM campaign specified', '25', '250', '0.1'],
    [DAY, PACKAGE, 'Google Play explore', 'No search terms specified', 'No UTM source specified', 'No UTM campaign specified', '15', '150', '0.1'],
  ]),
  [`stats/ratings/ratings_${PACKAGE}_${MONTH}_overview.csv`]: reportFile([
    ['Date', 'Package Name', 'Daily Average Rating', 'Total Average Rating'],
    [DAY, PACKAGE, '4.00', '4.31'],
  ]),
  [`stats/ratings/ratings_${PACKAGE}_${MONTH}_country.csv`]: reportFile([
    ['Date', 'Package Name', 'Country', 'Daily Average Rating', 'Total Average Rating'],
    [DAY, PACKAGE, 'US', '4.00', '4.40'],
    [DAY, PACKAGE, 'DE', '0.0', '3.90'],
  ]),
  [`reviews/reviews_${PACKAGE}_${MONTH}.csv`]: reportFile([
    ['Package Name', 'App Version Code', 'App Version Name', 'Reviewer Language', 'Device', 'Review Submit Date and Time', 'Review Submit Millis Since Epoch', 'Review Last Update Date and Time', 'Review Last Update Millis Since Epoch', 'Star Rating', 'Review Title', 'Review Text', 'Developer Reply Date and Time', 'Developer Reply Millis Since Epoch', 'Developer Reply Text', 'Review Link'],
    [PACKAGE, '30', '3.0', 'de', 'pixel8', `${DAY}T09:00:00Z`, String(Date.parse(`${DAY}T09:00:00Z`)), `${DAY}T09:00:00Z`, String(Date.parse(`${DAY}T09:00:00Z`)), '4', '', 'Gute App,\nnur die Suche fehlt.', `${DAY}T12:00:00Z`, String(Date.parse(`${DAY}T12:00:00Z`)), 'Danke, die Suche kommt.', `https://play.google.com/console/developers/1/app/2/user-feedback/review-details?reviewId=gp:old-1&corpus=PUBLISHED_REVIEWS`],
    [PACKAGE, '30', '3.0', 'en', 'pixel8', `${DAY}T10:00:00Z`, String(Date.parse(`${DAY}T10:00:00Z`)), `${DAY}T10:00:00Z`, String(Date.parse(`${DAY}T10:00:00Z`)), '5', '', '', '', '', '', ''],
  ]),
};

const json = (value: unknown) => JSON.stringify(value);
const now = Math.floor(Date.now() / 1000);

const RULES: TauriHttpRule[] = [
  { match: '^POST https://oauth2\\.googleapis\\.com/token$', body: json({ access_token: 'ya29.test-token', expires_in: 3600, token_type: 'Bearer' }) },
  // The store page, through an edit that is deleted again.
  { match: `^POST ${API}/edits$`, body: json({ id: 'edit-1', expiryTimeSeconds: String(now + 3600) }) },
  { match: `^GET ${API}/edits/edit-1/details$`, body: json({ defaultLanguage: 'en-US', contactEmail: 'hi@example.com' }) },
  {
    match: `^GET ${API}/edits/edit-1/listings$`,
    body: json({
      kind: 'androidpublisher#listingsListResponse',
      listings: [
        { language: 'en-US', title: 'Pebble Notes', shortDescription: 'Calm notes and lists', fullDescription: 'Pebble keeps your notes in one calm place.' },
        { language: 'de-DE', title: 'Pebble Notizen', shortDescription: '', fullDescription: 'Pebble bewahrt deine Notizen an einem ruhigen Ort auf.' },
      ],
    }),
  },
  { match: `^GET ${API}/edits/edit-1/listings/en-US/phoneScreenshots$`, body: json({ images: ['s1', 's2', 's3', 's4'].map((id) => ({ id, url: IMAGE(id) })) }) },
  { match: `^GET ${API}/edits/edit-1/listings/de-DE/phoneScreenshots$`, body: json({}) },
  { match: `^GET ${API}/edits/edit-1/listings/en-US/icon$`, body: json({ images: [{ id: 'i1', url: IMAGE('icon') }] }) },
  // Answered through tauri-plugin-http only: the browser's own request for this host is aborted offline.
  { match: '^GET https://lh3\\.googleusercontent\\.com/e2e-', headers: { 'content-type': 'image/png' }, bodyBase64: PIXEL_BASE64 },
  { match: `^DELETE ${API}/edits/edit-1$`, body: '' },
  // A store page change the user applies.
  { match: `^PATCH ${API}/edits/edit-1/listings/en-US$`, body: json({ language: 'en-US' }) },
  { match: `^POST ${API}/edits/edit-1:validate$`, body: json({ id: 'edit-1' }) },
  { match: `^POST ${API}/edits/edit-1:commit$`, body: json({ id: 'edit-1' }) },
  // Reviews written or changed in the last week, and a reply.
  {
    match: `^GET ${API}/reviews\\?`,
    body: json({
      reviews: [
        {
          reviewId: 'gp:new-1',
          authorName: 'Kai',
          comments: [{ userComment: { text: 'Lost my notes\tThe sync deleted a week of notes.', starRating: 1, lastModified: { seconds: String(now - 3600) }, reviewerLanguage: 'en_GB', appVersionName: '3.0' } }],
        },
      ],
      tokenPagination: {},
    }),
  },
  {
    match: `^POST ${API}/reviews/gp%3Anew-1:reply$`,
    body: json({ result: { replyText: 'Sorry about that. Version 3.1 fixes the sync.', lastEdited: { seconds: String(now) } } }),
  },
  // The monthly report files: one listing per folder, then each file.
  ...['stats/installs/', 'stats/store_performance/', 'stats/ratings/', 'reviews/'].map((folder) => ({
    match: `^GET ${STORAGE}/o\\?prefix=${escape(encodeURIComponent(folder))}`,
    body: json({
      kind: 'storage#objects',
      items: [
        ...Object.keys(FILES).filter((name) => name.startsWith(folder)).map((name) => ({ name, updated: `${DAY}T23:00:00Z`, size: '4096' })),
        // A breakdown Growth does not read.
        ...(folder === 'stats/installs/' ? [{ name: `stats/installs/installs_${PACKAGE}_${MONTH}_device.csv`, updated: `${DAY}T23:00:00Z`, size: '100' }] : []),
      ],
    }),
  })),
  ...Object.entries(FILES).map(([name, bodyBase64]) => ({
    match: `^GET ${STORAGE}/o/${escape(encodeURIComponent(name))}\\?alt=media$`,
    headers: { 'content-type': 'text/csv; charset=utf-16le' },
    bodyBase64,
  })),
];

test.use({ tauriConfig: { http: RULES } });

async function connect(page: Page, settings: Record<string, unknown> = {}) {
  await page.evaluate(
    ({ serviceAccountJson, packageName, settings, bucket }) => {
      localStorage.setItem('open-screenshot-generator.store-credentials', JSON.stringify({ playstore: { serviceAccountJson, packageName } }));
      localStorage.setItem('open-screenshot-generator.growth', JSON.stringify({ playReportsUri: `gs://${bucket}/stats/installs/`, ...settings }));
    },
    { serviceAccountJson: SERVICE_ACCOUNT, packageName: PACKAGE, settings, bucket: BUCKET }
  );
}

interface Request {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
}

function requests(page: Page): Promise<Request[]> {
  return page.evaluate(() => (window as unknown as { __E2E_TAURI__: { httpRequests: Request[] } }).__E2E_TAURI__.httpRequests);
}

/** Open Growth and wait for the first sync, whose last lines are the report files'. */
async function syncOnce(page: Page) {
  const view = await openGrowth(page);
  await section(view, 'Setup').click();
  await expect(view.getByText('4.3 stars on average, ratings from 2 countries')).toBeVisible({ timeout: 90_000 });
  return view;
}

/** Put a timeline event in the growth database before the app reads it, as the upload dialog would have. */
async function seedEvent(page: Page, event: Record<string, unknown>) {
  await page.evaluate(async (event) => {
    // Dexie's version 1 is IndexedDB's version 10; made with db.ts's stores when the app has not made it yet.
    const open = indexedDB.open('OpenScreenshotGeneratorGrowth', 10);
    open.onupgradeneeded = () => {
      const db = open.result;
      const store = (name: string, keyPath: string, indexes: Array<[string, string | string[]]>) => {
        const created = db.createObjectStore(name, { keyPath });
        for (const [index, path] of indexes) created.createIndex(index, path);
      };
      store('days', 'key', [['appId', 'appId'], ['[appId+date]', ['appId', 'date']]]);
      store('reviews', 'id', [['appId', 'appId'], ['[appId+createdDate]', ['appId', 'createdDate']]]);
      store('ratings', 'key', [['appId', 'appId']]);
      store('events', 'id', [['appId', 'appId'], ['[appId+date]', ['appId', 'date']]]);
      store('listings', 'appId', []);
      store('meta', 'key', []);
    };
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const tx = db.transaction('events', 'readwrite');
    tx.objectStore('events').put(event);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, event);
}

async function readEvent(page: Page, id: string): Promise<Record<string, unknown> | undefined> {
  return page.evaluate(async (id) => {
    const open = indexedDB.open('OpenScreenshotGeneratorGrowth');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const request = db.transaction('events').objectStore('events').get(id);
    const row = await new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as Record<string, unknown> | undefined);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return row;
  }, id);
}

let mcpCalls = 0;

async function mcpCall(tauri: TauriHarness, name: string, args: Record<string, unknown>) {
  const id = ++mcpCalls;
  const callId = `growth-play-call-${id}`;
  await tauri.emitFromBackend('abs-mcp-request', {
    callId,
    nonce: 'e2e-bridge-nonce',
    agent: true,
    message: { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } },
  });
  const reply = async () => (await tauri.callsTo('abs_mcp_respond')).find((call) => call.args.callId === callId);
  await expect.poll(async () => !!(await reply()), { timeout: 30_000, message: `${name} was never answered` }).toBe(true);
  const response = (await reply())!.args.response as { result?: { isError?: boolean; content?: Array<{ text?: string }> } };
  return { isError: response.result?.isError === true, text: response.result?.content?.[0]?.text ?? '' };
}

test.describe('growth on Google Play', () => {
  test('a sync reads the store page, the reviews and the report files, and every screen uses Google Play numbers', async ({ app, page, tauri }) => {
    await connect(page);
    await app.goto();
    await app.dismissStartDialog();

    const view = await openGrowth(page);
    // Named after its package until the store page has been read, then after its title.
    await expect(view.getByRole('combobox', { name: 'App' })).toContainText(/Pebble Notes|com\.example\.pebble/);

    const setup = await syncOnce(page);
    await expect(view.getByRole('combobox', { name: 'App' })).toContainText('Pebble Notes');
    await expect(setup.getByRole('heading', { name: 'Data from Google' })).toBeVisible();
    await expect(setup.getByText('2 languages')).toBeVisible();
    await expect(setup.getByText('2 written reviews', { exact: true })).toBeVisible();
    await expect(setup.getByText(/^Numbers up to /)).toBeVisible();
    await expect(setup.getByText(/Sales and Trends/)).toHaveCount(0);
    await expect(setup.getByRole('textbox', { name: 'Cloud Storage URI' })).toHaveValue(`gs://${BUCKET}/stats/installs/`);

    await section(view, 'Overview').click();
    await expect(view.getByRole('button', { name: /^Page visits 400/ })).toBeVisible();
    await expect(view.getByRole('button', { name: /^Download rate 10\.0%/ })).toBeVisible();
    await expect(view.getByRole('button', { name: /^New downloads 40/ })).toBeVisible();
    await expect(view.getByRole('button', { name: /^Updates 55/ })).toBeVisible();
    await expect(view.getByRole('button', { name: /^Rating 4\.3 Average of all ratings/ })).toBeVisible();
    await expect(view.getByRole('button', { name: /^Times seen/ })).toHaveCount(0);
    await expect(view.getByRole('button', { name: /^Earnings/ })).toHaveCount(0);
    await expect(view.getByText('Google Play search')).toBeVisible();

    await section(view, 'Countries').click();
    await expect(view.getByRole('button', { name: 'Sort by Page visits' })).toBeVisible();
    await expect(view.getByRole('button', { name: 'Sort by Times seen' })).toHaveCount(0);
    // Page visits, the download rate from them, downloads, and the main language the store page has.
    await expect(view.getByRole('row', { name: /^GermanyDE 100 10\.0% 10 German$/ })).toBeVisible();
    await expect(view.getByRole('row', { name: /^United StatesUS 300 10\.0% 30 English$/ })).toBeVisible();

    await section(view, 'Store page').click();
    await expect(view.getByText('Google Play store page')).toBeVisible();
    // Google Play's three fields, by Google's names, and nothing Apple has.
    await expect(view.getByRole('textbox', { name: 'Title' })).toHaveValue('Pebble Notes');
    await expect(view.getByRole('textbox', { name: 'Short description' })).toHaveValue('Calm notes and lists');
    await expect(view.getByRole('textbox', { name: 'Full description' })).toHaveValue('Pebble keeps your notes in one calm place.');
    await expect(view.locator('#growth-field-keywords')).toHaveCount(0);
    await expect(view.locator('#growth-field-promotionalText')).toHaveCount(0);
    await expect(view.getByRole('checkbox', { name: 'Short description' })).toBeChecked();
    await expect(view.getByText('Your phone screenshots in Play Console')).toBeVisible();
    const shots = view.getByRole('img', { name: /^Live screenshot / });
    await expect(shots).toHaveCount(4);
    // Each one fetched by the app and shown from memory, so each has pixels.
    await expect
      .poll(() => shots.evaluateAll((images) => images.map((image) => (image as HTMLImageElement).naturalWidth > 0 && (image as HTMLImageElement).src.startsWith('blob:'))))
      .toEqual([true, true, true, true]);
    await view.getByRole('tab', { name: /German/ }).click();
    await expect(view.getByText('No short description')).toBeVisible();

    await section(view, 'Reviews').click();
    await expect(view.locator('[data-review-id="gp:old-1"]')).toContainText('nur die Suche fehlt.');
    await expect(view.locator('[data-review-id="gp:old-1"]')).toContainText('Danke, die Suche kommt.');
    await expect(view.locator('[data-review-id="gp:new-1"]')).toContainText('in British English');
    await expect(view.getByRole('combobox', { name: 'Filter by language' })).toBeVisible();

    const sent = await requests(page);
    const toGoogle = sent.filter((request) => /^https:\/\/(androidpublisher|storage)\.googleapis\.com\//.test(request.url));
    expect(toGoogle.length).toBeGreaterThan(15);
    for (const request of toGoogle) expect(request.headers.authorization).toBe('Bearer ya29.test-token');
    // One token for the Play API and for reading the report files.
    const token = sent.find((request) => request.url === 'https://oauth2.googleapis.com/token');
    const assertion = new URLSearchParams(token!.body!).get('assertion')!;
    const claims = JSON.parse(Buffer.from(assertion.split('.')[1], 'base64url').toString());
    expect(claims.scope).toBe('https://www.googleapis.com/auth/androidpublisher https://www.googleapis.com/auth/devstorage.read_only');
    expect(claims.iss).toBe('growth@pebble-play.iam.gserviceaccount.com');
    // The store page was read through an edit that was deleted again, never committed.
    const opened = sent.filter((request) => request.method === 'POST' && /\/edits$/.test(request.url)).length;
    const deleted = sent.filter((request) => request.method === 'DELETE' && /\/edits\/edit-1$/.test(request.url)).length;
    expect(opened).toBeGreaterThan(0);
    expect(deleted).toBe(opened);
    expect(sent.some((request) => request.url.includes(':commit') || request.method === 'PATCH')).toBe(false);
    // The breakdown Growth does not read was never downloaded.
    expect(sent.some((request) => request.url.includes('_device.csv'))).toBe(false);
    expect(await tauri.unhandled()).toEqual([]);
  });

  test('a reply goes to Google Play within its 350 characters, and a reply cannot be deleted there', async ({ app, page }) => {
    await connect(page);
    await app.goto();
    await app.dismissStartDialog();
    const view = await syncOnce(page);
    await section(view, 'Reviews').click();

    await expect(view.locator('[data-review-id="gp:old-1"]').getByRole('button', { name: 'Edit' })).toBeVisible();
    await expect(view.locator('[data-review-id="gp:old-1"]').getByRole('button', { name: 'Delete' })).toHaveCount(0);

    const review = view.locator('[data-review-id="gp:new-1"]');
    await review.getByRole('button', { name: 'Reply' }).click();
    const box = review.getByRole('textbox', { name: 'Reply' });
    await box.fill('x'.repeat(351));
    await expect(review.getByText('351 / 350')).toBeVisible();
    await expect(review.getByRole('button', { name: 'Send reply' })).toBeDisabled();
    await box.fill('Sorry about that. Version 3.1 fixes the sync.');
    await expect(review.getByText('Replies are public. Google Play shows each reply under the review.')).toBeVisible();
    await review.getByRole('button', { name: 'Send reply' }).click();
    await expect(review.getByText('Published')).toBeVisible();

    const posted = (await requests(page)).find((request) => request.method === 'POST' && request.url.endsWith('/reviews/gp%3Anew-1:reply'));
    expect(JSON.parse(posted!.body!)).toEqual({ replyText: 'Sorry about that. Version 3.1 fixes the sync.' });
  });

  test('a store page change goes to Google Play in one commit, and lands on the timeline', async ({ app, page }) => {
    await connect(page);
    await app.goto();
    await app.dismissStartDialog();
    const view = await syncOnce(page);
    await section(view, 'Store page').click();

    await view.locator('#growth-field-subtitle').fill('Calm notes, lists and reminders');
    await expect(view.getByText('Changes to apply')).toBeVisible();
    await view.getByRole('button', { name: 'Apply in Play Console' }).click();
    await expect(view.getByText(/^Applied 1 change in Play Console\. Google checks the changes before people see the changes/)).toBeVisible();

    const sent = await requests(page);
    const patch = sent.find((request) => request.method === 'PATCH');
    expect(patch?.url).toMatch(/\/edits\/edit-1\/listings\/en-US$/);
    expect(JSON.parse(patch!.body!)).toEqual({ shortDescription: 'Calm notes, lists and reminders' });
    const after = sent.slice(sent.indexOf(patch!));
    expect(after.filter((request) => request.url.endsWith('edit-1:validate'))).toHaveLength(1);
    expect(after.filter((request) => request.url.endsWith('edit-1:commit'))).toHaveLength(1);

    await section(view, 'Timeline').click();
    await expect(view.getByText('Store page updated')).toBeVisible();
    await expect(view.getByText('short description in 1 language')).toBeVisible();
  });

  test('new screenshots Google Play holds for review wait for the day the user says they went live', async ({ app, page }) => {
    await connect(page);
    await app.goto();
    await app.dismissStartDialog();
    const uploaded = utcDay(-20);
    await seedEvent(page, {
      id: 'shots:play-held',
      appId: APP_ID,
      date: uploaded,
      kind: 'screenshots',
      title: 'New screenshots uploaded',
      detail: '4 screenshots in 1 language from "Spring"',
      origin: 'publish',
      locales: ['en-US'],
      screenshotCount: 4,
      waitsForReview: true,
      createdAt: Date.now(),
    });
    const view = await syncOnce(page);
    await section(view, 'Overview').click();
    const hero = view.getByTestId('growth-impact');
    await expect(hero).toContainText('Not on Google Play yet');
    await expect(hero).toContainText('Google Play holds the new screenshots until you send the changes for review in Play Console');

    const day = hero.getByLabel('Day the new screenshots went live');
    await day.fill(DAY);
    await hero.getByRole('button', { name: 'Save the day' }).click();
    await expect(hero).not.toContainText('Not on Google Play yet');
    await expect(hero).toContainText('on Google Play since');
    await expect(hero).toContainText('Growth compares your numbers before and after the day you set.');
    expect((await readEvent(page, 'shots:play-held'))?.liveDate).toBe(DAY);
  });

  test('the agent reads the Google Play app through the store tools', async ({ app, page, tauri }) => {
    await connect(page);
    await app.goto();
    await app.dismissStartDialog();
    await syncOnce(page);
    await backToEditor(page);

    const overview = await mcpCall(tauri, 'get_store_overview', {});
    expect(overview.isError, overview.text).toBe(false);
    const digest = JSON.parse(overview.text);
    expect(digest.app).toEqual({ id: APP_ID, name: 'Pebble Notes', store: 'Google Play' });
    expect(digest.totals.current.storeListingVisitors).toBe(400);
    expect(digest.totals.current.downloadRate).toBe(0.1);
    expect(digest.totals.current.newDownloads).toBe(40);
    expect(digest.listing.languages[0]).toMatchObject({ locale: 'en-US', title: 'Pebble Notes', shortDescription: 'Calm notes and lists' });

    const refused = await mcpCall(tauri, 'get_store_metrics', { metric: 'impressions' });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('Google Play has no impressions for this app');

    const listing = JSON.parse((await mcpCall(tauri, 'get_store_listing', { locale: 'en-US' })).text);
    expect(listing.limits).toEqual({ title: 30, shortDescription: 80, fullDescription: 4000 });
    const reviews = JSON.parse((await mcpCall(tauri, 'list_store_reviews', { maxRating: 2 })).text);
    expect(reviews.reviews).toEqual([expect.objectContaining({ rating: 1, language: 'en-GB', title: 'Lost my notes' })]);
  });
});

test.describe('growth on Google Play, beside the App Store', () => {
  test.use({ tauriConfig: { http: [...TEST_ACCOUNT_RULES, ...RULES] } });

  test('with both keys the picker lists the App Store apps and the Google Play app apart', async ({ app, page }) => {
    await page.evaluate(
      ({ key, serviceAccountJson, packageName, appId, bucket }) => {
        localStorage.setItem(
          'open-screenshot-generator.store-credentials',
          JSON.stringify({
            appstore: { issuerId: '69a6de70-0000-47e3-e053-5b8c7c11a4d1', keyId: 'ABCD123456', privateKey: key },
            playstore: { serviceAccountJson, packageName },
          })
        );
        localStorage.setItem('open-screenshot-generator.growth', JSON.stringify({ appId, playReportsUri: `gs://${bucket}` }));
      },
      { key: TEST_KEY, serviceAccountJson: SERVICE_ACCOUNT, packageName: PACKAGE, appId: APP_ID, bucket: BUCKET }
    );
    await app.goto();
    await app.dismissStartDialog();
    const view = await syncOnce(page);
    await expect(view.getByText('Google Play', { exact: true }).first()).toBeVisible();

    await view.getByRole('combobox', { name: 'App' }).click();
    const list = page.getByRole('listbox');
    await expect(list.getByRole('group', { name: 'App Store' }).getByRole('option', { name: TEST_APP.name })).toBeVisible();
    await expect(list.getByRole('group', { name: 'Google Play' }).getByRole('option', { name: 'Pebble Notes' })).toBeVisible();
    await page.keyboard.press('Escape');
  });
});

test.describe('a Google Play upload from the editor', () => {
  // Google takes the screenshots only without sending them for review, as it
  // does for an app with changes rejected before: the upload commits again
  // with changesNotSentForReview, and the new screenshots wait in Play Console.
  test.use({
    tauriConfig: {
      http: [
        {
          match: `^POST ${API}/edits/edit-1:commit$`,
          status: 400,
          body: json({ error: { code: 400, message: 'Changes cannot be sent for review automatically. Please set the query parameter changesNotSentForReview to true.' } }),
        },
        { match: `^POST ${API}/edits/edit-1:commit\\?changesNotSentForReview=true$`, body: json({ id: 'edit-1' }) },
        {
          match: `^POST https://androidpublisher\\.googleapis\\.com/upload/androidpublisher/v3/applications/${escape(PACKAGE)}/edits/edit-1/listings/en-US/phoneScreenshots\\?uploadType=media$`,
          body: json({ image: { id: 'new-1', url: PIXEL } }),
        },
        ...RULES,
      ],
    },
  });

  test('lands on the Growth timeline, and the screenshots wait until the user says they went live', async ({ app, page }) => {
    await connect(page);
    await app.goto();
    await app.startBlankProject();
    await app.chooseFromMenu(app.saveButton, /To App Store Connect or Google Play/i);
    const dialog = page.getByRole('dialog').filter({ hasText: 'Upload to the store' });
    await dialog.getByRole('button', { name: 'Google Play', exact: true }).click();
    await expect(dialog.getByText(PACKAGE)).toBeVisible();
    // The editor's board is an iPhone size; Google Play takes it at a phone size it allows.
    await dialog.getByRole('combobox').filter({ hasText: 'Current canvas' }).click();
    await page.getByRole('option', { name: /^Android 1080x1920/ }).click();
    const upload = dialog.getByRole('button', { name: /^Upload \d/ });
    await expect(upload).toBeEnabled({ timeout: 30_000 });
    await upload.click();
    await expect(dialog.getByText(/Committed without sending for review/)).toBeVisible({ timeout: 90_000 });

    const sent = await requests(page);
    expect(sent.filter((request) => request.url.includes('/upload/androidpublisher/'))).toHaveLength(1);
    expect(sent.some((request) => request.url.endsWith(':commit?changesNotSentForReview=true'))).toBe(true);

    await dialog.getByRole('button', { name: 'See results in Growth' }).click();
    const view = page.getByTestId('growth-view');
    await expect(view).toBeVisible();
    await expect(view.getByRole('combobox', { name: 'App' })).toContainText(/Pebble Notes|com\.example\.pebble/);
    await section(view, 'Setup').click();
    await expect(view.getByText('4.3 stars on average, ratings from 2 countries')).toBeVisible({ timeout: 90_000 });
    await section(view, 'Overview').click();
    const hero = view.getByTestId('growth-impact');
    await expect(hero).toContainText('Not on Google Play yet');
    await expect(hero).toContainText('Google Play holds the new screenshots until you send the changes for review in Play Console');
    await expect(hero.getByLabel('Day the new screenshots went live')).toBeVisible();
  });
});

test.describe('growth on Google Play, next to competitors', () => {
  test('Competitors reads the app\'s own Google Play page with the apps it follows, in each country', async ({ app, page }) => {
    // Google Play pages come from FakeAppStore, before this file's rules for the API and the reports.
    const store = new FakeAppStore(page, true, RULES);
    const own = (overrides: Partial<PlayListing> = {}) =>
      playListing({ packageName: PACKAGE, name: 'Pebble Notes', developer: 'Pebble Labs', rating: 4.6, ratingCount: 210, screenshots: [playShot('pebble-1'), playShot('pebble-2')], ...overrides });
    const rival = (overrides: Partial<PlayListing> = {}) =>
      playListing({ packageName: 'com.rival.notes', name: 'Rival Notes', developer: 'Rival Labs', rating: 3.9, ratingCount: 5400, screenshots: [1, 2, 3].map((n) => playShot(`rival-${n}`)), ...overrides });
    await connect(page);
    await app.goto();
    await store.install();
    await store.showOnPlay('US', [own(), rival()]);
    await store.showOnPlay('DE', [own({ rating: 4.1 }), rival({ rating: 3.5 })]);
    await app.dismissStartDialog();

    const view = await syncOnce(page);
    await section(view, 'Competitors').click();
    const screen = page.getByTestId('growth-competitors');
    // The United States and Germany only: each country is a page per app.
    // The list can still be taking in the app's busiest countries when it is first read, so it is read again until it settles.
    const countryList = screen.getByTestId('growth-competitor-country-list');
    await expect(async () => {
      for (const name of (await countryList.getByRole('listitem').allTextContents()).map((text) => text.trim())) {
        if (name !== 'United States' && name !== 'Germany') await countryList.getByRole('button', { name: `Stop checking ${name}` }).click();
      }
      await expect(countryList.getByRole('listitem')).toHaveText(['United States', 'Germany'], { timeout: 2_000 });
    }).toPass({ timeout: 30_000 });

    await screen.getByRole('textbox', { name: 'Find an app to follow' }).fill('https://play.google.com/store/apps/details?id=com.rival.notes');
    await screen.getByRole('list', { name: 'Apps found' }).getByRole('button', { name: 'Follow Rival Notes', exact: true }).click();
    await expect(screen.getByTestId('growth-competitors-checked')).toContainText('Checked just now', { timeout: 30_000 });

    // The app's own page is read with the competitor's, in each country.
    const asked = (await store.playRequests()).map((url) => `${url.searchParams.get('id')} ${url.searchParams.get('gl')}`);
    expect(asked).toEqual(expect.arrayContaining([`${PACKAGE} US`, `${PACKAGE} DE`, 'com.rival.notes US', 'com.rival.notes DE']));
    const rows = screen.getByTestId('growth-competitor-compare').getByTestId('growth-competitor-row');
    const yours = rows.filter({ hasText: 'You' }).first();
    await expect(yours).toHaveAttribute('data-app-name', 'Pebble Notes');
    // The two screenshots of the store page, not the four of the Growth refresh.
    await expect(yours.getByRole('img', { name: /^Pebble Notes, screenshot/ })).toHaveCount(2);
    await expect(rows.filter({ hasText: 'Rival Notes' }).getByRole('img', { name: /^Rival Notes, screenshot/ })).toHaveCount(3);
    const germany = screen.getByTestId('growth-competitor-countries').getByRole('row', { name: /^Germany/ });
    await expect(germany).toContainText('4.1 (210)');
    await expect(germany).toContainText('3.5 (5,400)');
  });
});
