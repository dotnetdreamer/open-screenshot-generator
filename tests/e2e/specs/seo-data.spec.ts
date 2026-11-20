import { generateKeyPairSync } from 'node:crypto';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures/test';
import type { TauriHttpRule } from '../fixtures/tauri-runtime';
import { CLAUDE_READY, SITE, checkSite, escapeRegExp, openSeo, section, serveFork, serveSites, showSeo, sitePages } from '../helpers/seo';

// SEO's numbers that belong to one site, one property or one project: a
// PageSpeed test after a switch of site, Search Console and Analytics read
// apart (one can fail alone) and per property, a site checked before it's
// published from its own project's artboards, and Ask AI's Google setup
// when finding the AI takes longer than the screen takes to show. Google is
// answered by the Tauri HTTP plugin's stand-in, PageSpeed in a browser by
// page.route; the sites are made up (tests/e2e/helpers/seo.ts).

const OTTER = 'https://otter.example';
const API_KEY = `AIza${'e'.repeat(35)}`;
const PRIVATE_KEY = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const SEO_KEY = JSON.stringify({
  type: 'service_account',
  project_id: 'pebble-seo',
  client_email: 'osg-seo@pebble-seo.iam.gserviceaccount.com',
  private_key: PRIVATE_KEY,
  token_uri: 'https://oauth2.googleapis.com/token',
});
const WEBSITE = "Website: your app's home, support and privacy pages";

const json = (value: unknown) => JSON.stringify(value);

/** PageSpeed's answer, with this speed score. */
/** A PageSpeed answer for `tested`, naming it the way a real one does (id and Lighthouse's URLs): one that names no page isn't kept. */
function psi(performance: number, tested: string): string {
  return json({
    id: tested,
    lighthouseResult: { requestedUrl: tested, finalUrl: tested, mainDocumentUrl: tested, finalDisplayedUrl: tested, categories: { performance: { score: performance / 100 }, seo: { score: 0.9 }, accessibility: { score: 0.9 } }, audits: {} },
    loadingExperience: { metrics: {} },
  });
}

/** One day of Search Console rows, with this many clicks. */
function searchRows(clicks: number): string {
  return json({ rows: [{ keys: ['2026-11-10'], clicks, impressions: clicks * 10, ctr: 0.1, position: 12.5 }] });
}

/** SEO's Google settings, set before the app reads them, and the app loaded again. */
async function seoSettings(page: Page, settings: Record<string, unknown>): Promise<void> {
  await page.evaluate((value) => localStorage.setItem('open-screenshot-generator.seo-google', JSON.stringify(value)), settings);
  await page.reload();
}

async function pickSite(page: Page, view: Locator, name: string | RegExp): Promise<void> {
  await view.getByLabel('Site to check').click();
  await page.getByRole('option', { name }).click();
}

/**
 * The Website view's site for `projectId`, as published at `url`: the record
 * a publish leaves (nothing here reaches GitHub), then the app loaded again
 * so every view reads it fresh.
 */
async function publishAt(page: Page, projectId: string, url: string): Promise<void> {
  await page.evaluate(
    async ({ projectId, url }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open('OpenScreenshotGeneratorWebsite');
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      await new Promise<void>((resolve, reject) => {
        const store = db.transaction('sites', 'readwrite').objectStore('sites');
        const get = store.get(projectId);
        get.onsuccess = () => {
          const row = get.result;
          if (!row) return reject(new Error(`no Website view site for ${projectId}`));
          row.draft.publish = { owner: 'pebble', repo: 'pebble.github.io', branch: 'main', url, at: Date.now(), build: 'e2e', fingerprint: 'e2e', live: true };
          const put = store.put(row);
          put.onsuccess = () => resolve();
          put.onerror = () => reject(put.error);
        };
        get.onerror = () => reject(get.error);
      });
      db.close();
    },
    { projectId, url }
  );
  await page.reload();
}

/** What the desktop app asked the Tauri HTTP plugin for. */
async function sent(page: Page): Promise<Array<{ method: string; url: string }>> {
  return page.evaluate(() => (window as unknown as { __E2E_TAURI__: { httpRequests: Array<{ method: string; url: string }> } }).__E2E_TAURI__.httpRequests);
}

test.describe('SEO numbers per site, property and project', () => {
  // Each test checks one or two whole sites. On a dev server that hasn't
  // compiled the app yet, the first one also waits for that (seen: a cold
  // Chromium run of the Speed test went past 90 seconds and passed again warm).
  test.describe.configure({ timeout: 180_000 });
  test('Speed tests a page of the site on screen, right after a switch of site too', async ({ page, app, isDesktop }) => {
    await serveFork(page);
    await seoSettings(page, { apiKey: API_KEY });
    const tested: string[] = [];
    await page.route(/^https:\/\/www\.googleapis\.com\/pagespeedonline\//, (route) => {
      const asked = new URL(route.request().url()).searchParams.get('url') ?? '';
      tested.push(asked);
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: psi(64, asked) });
    });
    await serveSites(page, isDesktop, { [SITE]: sitePages(), [OTTER]: sitePages({}, OTTER) }, [
      // The desktop's stand-in answers one body for every request: the page this test asks for.
      { match: '^GET https://www\\.googleapis\\.com/pagespeedonline/v5/runPagespeed\\?', headers: { 'content-type': 'application/json' }, body: psi(64, `${OTTER}/`) },
    ]);
    const view = await openSeo(page, app);
    await checkSite(view);
    await expect(view.getByTestId('seo-score')).toBeVisible({ timeout: 30_000 });
    await section(view, 'Setup').click();
    await view.getByLabel("A website's address").fill('otter.example');
    await view.getByRole('button', { name: 'Add and check' }).click();
    await expect(view.getByTestId('seo-score')).toContainText('2 pages', { timeout: 30_000 });
    await expect(view.getByTestId('seo-check-now')).toBeVisible({ timeout: 30_000 });

    // On Pebble's Speed screen, pick Pebble's support page, then switch to Otter.
    await pickSite(page, view, 'pebble.example');
    await section(view, 'Speed').click();
    await view.getByLabel('Page to test').click();
    await page.getByRole('option', { name: '/support' }).click();
    await pickSite(page, view, 'otter.example');
    await view.getByTestId('seo-test-speed').click();
    await expect(view.getByText('otter.example on a phone')).toBeVisible({ timeout: 30_000 });

    const asked = isDesktop
      ? (await sent(page)).filter((request) => request.url.includes('pagespeedonline')).map((request) => new URL(request.url).searchParams.get('url'))
      : tested;
    expect(asked).toEqual([`${OTTER}/`]);
    // Pebble never had a test, and Otter's result stays Otter's.
    await pickSite(page, view, 'pebble.example');
    await expect(view.getByText('No phone test yet')).toBeVisible();
  });

  test('a Website view site that moves: the Overview says the check read the old address, and Speed tests the new one', async ({ page, app, isDesktop }) => {
    await serveFork(page);
    await seoSettings(page, { apiKey: API_KEY });
    const tested: string[] = [];
    await page.route(/^https:\/\/www\.googleapis\.com\/pagespeedonline\//, (route) => {
      const asked = new URL(route.request().url()).searchParams.get('url') ?? '';
      tested.push(asked);
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: psi(64, asked) });
    });
    // The desktop stand-in keeps its rules in the page, so a reload (publishAt) needs them again; page.route stays.
    const serve = () =>
      serveSites(page, isDesktop, { [SITE]: sitePages(), [OTTER]: sitePages({}, OTTER) }, [
        { match: '^GET https://www\\.googleapis\\.com/pagespeedonline/v5/runPagespeed\\?', headers: { 'content-type': 'application/json' }, body: psi(64, `${OTTER}/`) },
      ]);
    await serve();
    // A Website view site, made as a developer makes one.
    await app.startBlankProject();
    await app.addElementFrom('Basic', 'Text', 'basic:text');
    const projectId = new URL(page.url()).searchParams.get('projectId');
    expect(projectId).toBeTruthy();
    await page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: WEBSITE, exact: true }).click();
    const website = page.getByTestId('website-view');
    await website.getByRole('button', { name: 'Make my website' }).click();
    const dialog = page.getByTestId('website-setup');
    await dialog.getByLabel('App name').fill('Pebble');
    await dialog.getByLabel('Support email').fill('help@pebble.app');
    await dialog.getByLabel("Your name or your company's").fill('Pebble Labs');
    await dialog.getByRole('button', { name: 'Next' }).click();
    await dialog.getByText('Nothing', { exact: true }).click();
    await dialog.getByRole('button', { name: 'Next' }).click();
    await dialog.getByRole('button', { name: 'Make my website' }).click();
    await expect(dialog).toBeHidden();

    // Published at pebble.example and checked there: Speed offers its pages.
    await publishAt(page, projectId!, `${SITE}/`);
    if (isDesktop) await serve();
    const view = await openSeo(page, app);
    await pickSite(page, view, /Pebble/);
    await view.getByTestId('seo-check-now').click();
    await expect(view.getByTestId('seo-score')).toContainText('2 pages', { timeout: 30_000 });
    await expect(view.getByTestId('seo-check-now')).toBeVisible({ timeout: 30_000 });
    await section(view, 'Speed').click();
    await view.getByLabel('Page to test').click();
    await expect(page.getByRole('option', { name: '/support' })).toBeVisible();
    await page.keyboard.press('Escape');

    // Moved to otter.example: the last check is of the old address, said so, and Speed tests the new one.
    await publishAt(page, projectId!, `${OTTER}/`);
    if (isDesktop) await serve();
    await openSeo(page, app);
    await pickSite(page, view, /Pebble/);
    await expect(view.getByText('This check read pebble.example, where the site was before. Check again to read it at otter.example.')).toBeVisible({ timeout: 30_000 });
    await section(view, 'Speed').click();
    await expect(view.getByLabel('Page to test')).toHaveCount(0);
    await view.getByTestId('seo-test-speed').click();
    await expect(view.getByText('otter.example on a phone')).toBeVisible({ timeout: 30_000 });
    const asked = isDesktop
      ? (await sent(page)).filter((request) => request.url.includes('pagespeedonline')).map((request) => new URL(request.url).searchParams.get('url'))
      : tested;
    expect(asked).toEqual([`${OTTER}/`]);
  });

  test("Google: one service failing keeps the other's numbers, and a new property never shows the old one's", async ({ page, app, isDesktop }) => {
    test.skip(!isDesktop, 'Search Console and Analytics are read in the desktop app');
    await serveFork(page);
    await seoSettings(page, {
      key: SEO_KEY,
      sites: { [`url:${SITE}/`]: { searchConsole: 'sc-domain:pebble.example', analytics: 'properties/111', analyticsName: 'Pebble' } },
    });
    const query = (property: string) => `^POST https://www\\.googleapis\\.com/webmasters/v3/sites/${escapeRegExp(encodeURIComponent(property))}/searchAnalytics/query$`;
    const rules: TauriHttpRule[] = [
      { match: '^POST https://oauth2\\.googleapis\\.com/token$', body: json({ access_token: 'ya29.seo', expires_in: 3600, token_type: 'Bearer' }) },
      { match: '^GET https://www\\.googleapis\\.com/webmasters/v3/sites$', body: json({ siteEntry: [{ siteUrl: 'sc-domain:pebble.example', permissionLevel: 'siteFullUser' }, { siteUrl: `${SITE}/`, permissionLevel: 'siteFullUser' }] }) },
      { match: query('sc-domain:pebble.example'), body: searchRows(120) },
      // The other property's numbers wait, so the screen can be seen in between.
      { match: query(`${SITE}/`), body: searchRows(7), hold: true },
      { match: '^GET https://analyticsadmin\\.googleapis\\.com/v1beta/accountSummaries', body: json({ accountSummaries: [{ displayName: 'Pebble Labs', propertySummaries: [{ property: 'properties/111', displayName: 'Pebble' }] }] }) },
      {
        match: '^POST https://analyticsdata\\.googleapis\\.com/v1beta/properties/111:batchRunReports$',
        status: 403,
        headers: { 'content-type': 'application/json' },
        body: json({
          error: {
            code: 403,
            message: 'Google Analytics Data API has not been used in project 123 before or it is disabled.',
            status: 'PERMISSION_DENIED',
            details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'SERVICE_DISABLED', metadata: { activationUrl: 'https://console.developers.google.com/apis/api/analyticsdata.googleapis.com/overview?project=123' } }],
          },
        }),
      },
    ];
    await serveSites(page, isDesktop, { [SITE]: sitePages() }, rules);
    const view = await openSeo(page, app);
    await checkSite(view);
    await expect(view.getByTestId('seo-score')).toBeVisible({ timeout: 30_000 });

    // Analytics is turned off: Search's numbers still arrive, and each screen has its own news.
    await section(view, 'Search').click();
    await expect(view.getByTestId('seo-search-tiles')).toContainText('120', { timeout: 30_000 });
    await expect(view.getByText('is turned off for this key')).toHaveCount(0);
    await section(view, 'Visitors').click();
    await expect(view.getByText('The Google Analytics Data API is turned off')).toBeVisible();
    await expect(view.getByRole('button', { name: 'Turn it on in Google Cloud' })).toBeVisible();

    // Another Search Console property: the old one's numbers go at once, and the new one's are read.
    await section(view, 'Setup').click();
    await view.getByLabel('Search Console property').click();
    await page.getByRole('option', { name: `${SITE}/` }).click();
    await section(view, 'Search').click();
    await expect(view).toContainText(`${SITE}/, the last 28 days`);
    await expect(view.getByText('Getting your numbers from Google')).toBeVisible();
    await expect(view.getByTestId('seo-search-tiles')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __E2E_TAURI__: { httpHeld: unknown[] } }).__E2E_TAURI__.httpHeld.length)).toBeGreaterThan(0);
    await page.evaluate(() => (window as unknown as { __E2E_TAURI__: { releaseHttp(): number } }).__E2E_TAURI__.releaseHttp());
    await expect(view.getByTestId('seo-search-tiles')).toContainText('7', { timeout: 30_000 });
    await expect(view.getByTestId('seo-search-tiles')).not.toContainText('120');
  });

  test("Google: Search Console's numbers show while Analytics is still on its way", async ({ page, app, isDesktop }) => {
    test.skip(!isDesktop, 'Search Console and Analytics are read in the desktop app');
    await serveFork(page);
    await seoSettings(page, {
      key: SEO_KEY,
      sites: { [`url:${SITE}/`]: { searchConsole: 'sc-domain:pebble.example', analytics: 'properties/111', analyticsName: 'Pebble' } },
    });
    const analytics = json({
      reports: [
        { rows: [{ metricValues: [{ value: '345' }, { value: '400' }, { value: '210' }, { value: '900' }] }] },
        { rows: [{ metricValues: [{ value: '300' }, { value: '350' }, { value: '180' }, { value: '800' }] }] },
        { rows: [] },
        { rows: [] },
        { rows: [] },
      ],
    });
    await serveSites(page, isDesktop, { [SITE]: sitePages() }, [
      { match: '^POST https://oauth2\\.googleapis\\.com/token$', body: json({ access_token: 'ya29.seo', expires_in: 3600, token_type: 'Bearer' }) },
      { match: '^GET https://www\\.googleapis\\.com/webmasters/v3/sites$', body: json({ siteEntry: [{ siteUrl: 'sc-domain:pebble.example', permissionLevel: 'siteFullUser' }] }) },
      { match: `^POST https://www\\.googleapis\\.com/webmasters/v3/sites/${escapeRegExp(encodeURIComponent('sc-domain:pebble.example'))}/searchAnalytics/query$`, body: searchRows(120) },
      { match: '^GET https://analyticsadmin\\.googleapis\\.com/v1beta/accountSummaries', body: json({ accountSummaries: [{ displayName: 'Pebble Labs', propertySummaries: [{ property: 'properties/111', displayName: 'Pebble' }] }] }) },
      // Analytics answers only when the test says so.
      { match: '^POST https://analyticsdata\\.googleapis\\.com/v1beta/properties/111:batchRunReports$', body: analytics, hold: true },
    ]);
    const view = await openSeo(page, app);
    await checkSite(view);
    await expect(view.getByTestId('seo-score')).toBeVisible({ timeout: 30_000 });
    await section(view, 'Search').click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __E2E_TAURI__: { httpHeld: unknown[] } }).__E2E_TAURI__.httpHeld.length), { timeout: 30_000 }).toBeGreaterThan(0);
    // Analytics is held: Search Console's numbers are on screen anyway.
    await expect(view.getByTestId('seo-search-tiles')).toContainText('120', { timeout: 30_000 });
    expect(await page.evaluate(() => (window as unknown as { __E2E_TAURI__: { httpHeld: unknown[] } }).__E2E_TAURI__.httpHeld.length)).toBeGreaterThan(0);
    await page.evaluate(() => (window as unknown as { __E2E_TAURI__: { releaseHttp(): number } }).__E2E_TAURI__.releaseHttp());
    await section(view, 'Visitors').click();
    await expect(view.getByTestId('seo-visitor-tiles')).toContainText('345', { timeout: 30_000 });
  });

  test("before publishing, a site is drawn from its own project's artboards, not the open project's", async ({ page, app }) => {
    await serveFork(page);
    await app.startBlankProject();
    await app.addElementFrom('Basic', 'Text', 'basic:text');
    const first = new URL(page.url()).searchParams.get('projectId');
    expect(first).toBeTruthy();

    await page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: WEBSITE, exact: true }).click();
    const website = page.getByTestId('website-view');
    await website.getByRole('button', { name: 'Make my website' }).click();
    const dialog = page.getByTestId('website-setup');
    await dialog.getByLabel('App name').fill('Pebble');
    await dialog.getByLabel('Support email').fill('help@pebble.app');
    await dialog.getByLabel("Your name or your company's").fill('Pebble Labs');
    await dialog.getByRole('button', { name: 'Next' }).click();
    await dialog.getByText('Nothing', { exact: true }).click();
    await dialog.getByRole('button', { name: 'Next' }).click();
    await dialog.getByRole('button', { name: 'Make my website' }).click();
    await expect(dialog).toBeHidden();

    const view = await showSeo(page);
    await view.getByTestId('seo-check-now').click();
    await expect(view.getByTestId('seo-score')).toBeVisible({ timeout: 30_000 });
    const pictures = () =>
      page.evaluate(async (siteId) => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const open = indexedDB.open('OpenScreenshotGeneratorSeo');
          open.onsuccess = () => resolve(open.result);
          open.onerror = () => reject(open.error);
        });
        const runs = await new Promise<Array<{ siteId: string; finishedAt: number; pages: Array<{ label: string; checks?: { facts: { images: { total: number } } } }> }>>((resolve, reject) => {
          const request = db.transaction('runs').objectStore('runs').getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        db.close();
        const mine = runs.filter((run) => run.siteId === siteId).sort((a, b) => a.finishedAt - b.finishedAt);
        return mine.map((run) => run.pages.find((entry) => entry.label.startsWith('Home'))?.checks?.facts.images.total ?? -1);
      }, `web:${first}`);
    await expect.poll(pictures).toHaveLength(1);
    const [alone] = await pictures();

    // A second project, with two artboards, is open now.
    await page.getByRole('navigation', { name: 'Views' }).getByRole('button', { name: 'Editor', exact: true }).click();
    await app.create('Start from a template');
    await app.startBlankProject();
    await expect.poll(() => new URL(page.url()).searchParams.get('projectId')).not.toBe(first);
    const addArtboard = page.locator('div.absolute.-top-9').first().getByRole('button').first();
    await addArtboard.hover();
    await expect(page.getByRole('tooltip', { name: 'Add New Artboard After' })).toBeVisible();
    await addArtboard.click();
    await expect(app.artboards).toHaveCount(2);

    // Pebble's site stays on SEO's list, and is still drawn from Pebble's one artboard.
    await showSeo(page);
    await pickSite(page, view, /Pebble/);
    await view.getByTestId('seo-check-now').click();
    await expect.poll(pictures, { timeout: 30_000 }).toHaveLength(2);
    expect(await pictures()).toEqual([alone, alone]);
  });

  test.describe('with Claude Code', () => {
    // Finding Claude Code is held, so the Ask screen shows before the AI is known.
    test.use({ tauriConfig: { responses: { abs_claude_detect: CLAUDE_READY }, held: ['abs_claude_detect'] } });

    test("Ask AI's Google setup waits for the AI to be found, then starts", async ({ page, app, isDesktop, tauri }) => {
      test.skip(!isDesktop, 'The assistant and its browser are in the desktop app');
      await serveFork(page);
      await serveSites(page, isDesktop, { [SITE]: sitePages() });
      await tauri.setResponse('abs_claude_prompt', JSON.stringify({ say: 'Let us start with your Google key.', choices: [], actions: [], next: 'user' }));
      const view = await openSeo(page, app);
      await checkSite(view);
      await expect(view.getByTestId('seo-score')).toBeVisible({ timeout: 30_000 });
      await view.getByRole('button', { name: 'Set up with Ask AI' }).first().click();
      const growth = page.getByTestId('growth-view');
      await expect(growth.getByTestId('growth-ask-pending')).toContainText('Help me connect Google for my website');
      expect(await tauri.callsTo('abs_claude_prompt')).toHaveLength(0);
      // Claude Code is found now (each look for it, if there were several).
      await expect
        .poll(async () => {
          await page.evaluate(() => (window as unknown as { __E2E_TAURI__: { releaseCommands(): number } }).__E2E_TAURI__.releaseCommands());
          return growth.textContent();
        }, { timeout: 30_000 })
        .toContain('Let us start with your Google key.');
      const [call] = await tauri.callsTo('abs_claude_prompt');
      expect((call.args as { prompt: string }).prompt).toContain('The job now: set up Google for the SEO view');
      // The stores' setup progress has no place in the Google job.
      await expect(growth).not.toContainText('Connect your stores');
    });
  });
});
