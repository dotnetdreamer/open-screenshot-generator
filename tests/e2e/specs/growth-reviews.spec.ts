import { generateKeyPairSync } from 'node:crypto';
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/test';
import type { TauriHttpRule } from '../fixtures/tauri-runtime';
import { TEST_ACCOUNT_RULES, TEST_APP, TEST_KEY, connectTestAccount, gateOf, growthMeta, openGrowth, openGrowthSection, putGrowthRows, section } from '../helpers/growth';
import { sampleRatings, sampleReviews } from '../../fixtures/growthSample';

// The Ratings and reviews group of Growth: Ratings, the review inbox, the
// review summary, competitor reviews and Replies. With no app every screen is
// there and says why it waits. On the desktop the test account's reviews and
// ratings are written straight into the growth database, with a ratings
// history of two days, so new ratings and their stars show. Apple's public
// reviews feed and Slack are answered by the harness's HTTP rules.

const GROUP = ['Ratings', 'Reviews', 'Review summary', 'Competitor reviews', 'Replies'];

/** abs_claude_detect for a Claude Code signed in on a Max plan (ClaudeDetection). */
const CLAUDE_READY = {
  found: true,
  path: '/Users/e2e/.local/bin/claude',
  version: '2.1.285 (Claude Code)',
  loggedIn: true,
  authMethod: 'claude.ai',
  subscriptionType: 'max',
};

const RIVAL_ID = '993090598';
const SLACK = 'https://hooks.slack.com/services/T0E2E/B0E2E/e2etoken';
const PLAY_PACKAGE = 'com.example.pebble';

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function day(offset: number): string {
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
}

/** Two days of the US and Great Britain: ten new US ratings with their stars, two British ones without. */
function ratingDays() {
  const at = Date.now();
  return [
    {
      key: `${TEST_APP.id}|${day(-1)}`,
      appId: TEST_APP.id,
      date: day(-1),
      territories: {
        US: { average: 4.6, count: 2300, stars: [100, 60, 140, 400, 1600], version: '2.4', at: at - 86_400_000 },
        GB: { average: 4.5, count: 640, at: at - 86_400_000 },
      },
    },
    {
      key: `${TEST_APP.id}|${day(0)}`,
      appId: TEST_APP.id,
      date: day(0),
      territories: {
        US: { average: 4.6, count: 2310, stars: [101, 60, 141, 402, 1606], version: '2.4', at },
        GB: { average: 4.5, count: 642, at },
      },
    },
  ];
}

const CRASH = sampleReviews().find((review) => review.title === 'Crashes on launch')!;

/** A feed page of Apple's public reviews, in the shape measured on 2026-11-14. */
function feed(entries: Array<{ id: string; rating: number; title: string; body: string; days: number }>): string {
  return JSON.stringify({
    feed: {
      author: { name: { label: 'iTunes Store' } },
      entry: entries.map((entry) => ({
        author: { name: { label: `reviewer ${entry.id}` }, label: '' },
        updated: { label: new Date(Date.now() - entry.days * 86_400_000).toISOString() },
        'im:rating': { label: String(entry.rating) },
        'im:version': { label: '10.7.424' },
        id: { label: entry.id },
        title: { label: entry.title },
        content: { label: entry.body, attributes: { type: 'text' } },
        'im:voteSum': { label: '0' },
        'im:voteCount': { label: '0' },
      })),
    },
  });
}

const RIVAL_REVIEWS = [
  { id: '9001', rating: 1, title: 'Too many ads', body: 'An ad after every single move. Unplayable.', days: 1 },
  { id: '9002', rating: 2, title: 'Keeps crashing', body: 'The game crashes when I join a friend.', days: 2 },
  { id: '9003', rating: 5, title: 'Classic fun', body: 'Plays just like the board game. Love it.', days: 3 },
];

const RIVAL_RULES: TauriHttpRule[] = [
  {
    match: `^GET https://itunes\\.apple\\.com/us/rss/customerreviews/page=1/id=${RIVAL_ID}/sortby=mostrecent/json$`,
    headers: { 'content-type': 'text/javascript; charset=UTF-8' },
    body: feed(RIVAL_REVIEWS),
  },
  { match: `^POST ${escape(SLACK)}$`, headers: { 'content-type': 'text/html' }, body: 'ok' },
];

/** Follow one App Store app for the test app, checked a moment ago so no check starts. */
async function followRival(page: Page) {
  const now = Date.now();
  await putGrowthRows(page, {
    meta: [
      {
        key: `rivals:list:${TEST_APP.id}`,
        value: { owner: TEST_APP.id, rivals: [{ id: RIVAL_ID, name: 'Ludo King', developer: 'Gametion', iconUrl: null, addedAt: now }], countries: ['US'], checkedAt: now },
      },
      {
        key: `rivals:app:${RIVAL_ID}`,
        value: {
          id: RIVAL_ID,
          checkedAt: now,
          countries: {
            US: {
              territory: 'US',
              name: 'Ludo King',
              developer: 'Gametion',
              genre: 'Games',
              version: '10.7.424',
              releasedAt: '2026-11-04T04:31:17Z',
              releaseNotes: '',
              rating: 3.7,
              ratingCount: 19089,
              price: 0,
              priceLabel: 'Free',
              currency: 'USD',
              iconUrl: null,
              screenshots: [],
              ipadScreenshots: [],
              storeUrl: null,
              seenAt: now,
            },
          },
        },
      },
    ],
  });
}

/**
 * Growth on the test account's app. Until App Store Connect lists the
 * account's apps Growth shows no app, and the section on screen starts again
 * when the app arrives, so nothing is pressed before then.
 */
async function openApp(page: Page) {
  const view = await openGrowthSection(page, 'Overview');
  await expect(view.getByRole('combobox', { name: 'App' })).toContainText(TEST_APP.name);
  return view;
}

async function httpRequests(page: Page): Promise<Array<{ method: string; url: string; body: string | null }>> {
  return page.evaluate(() => (window as unknown as { __E2E_TAURI__: { httpRequests: Array<{ method: string; url: string; body: string | null }> } }).__E2E_TAURI__.httpRequests);
}

test.describe('growth ratings and reviews', () => {
  test('the group has its own buttons, and with no app each screen says why it waits', async ({ app, page, isDesktop }) => {
    await app.startBlankProject();
    const view = await openGrowth(page);
    const group = view.getByRole('group', { name: 'Ratings and reviews' });
    for (const name of GROUP) await expect(group.getByRole('button', { name: new RegExp(`^${name}`) })).toBeVisible();

    await section(view, 'Ratings').click();
    await expect(view.getByText('No ratings yet', { exact: true })).toBeVisible();
    await section(view, 'Reviews').click();
    await expect(view.getByText('No written reviews yet', { exact: true })).toBeVisible();
    await section(view, 'Review summary').click();
    await expect(view.getByText('Nothing to summarize yet', { exact: true })).toBeVisible();
    await section(view, 'Competitor reviews').click();
    await expect(view.getByText('No competitors yet', { exact: true })).toBeVisible();
    await section(view, 'Replies').click();
    await expect(view.getByText('Reply templates', { exact: true })).toBeVisible();
    // Slack posts go through the desktop app's own HTTP client.
    const send = view.getByRole('button', { name: 'Send a test message' });
    await expect(send).toBeDisabled();
    await expect(gateOf(send)).toHaveAttribute('data-gated-reason', isDesktop ? 'Paste a Slack webhook address first' : 'Slack alerts work in the desktop app only');
  });

  test.describe('on a connected account', () => {
    test.skip(({ isDesktop }) => !isDesktop, 'App Store Connect is reached through the desktop shell only');
    test.use({ tauriConfig: { http: [...TEST_ACCOUNT_RULES, ...RIVAL_RULES] } });

    test.beforeEach(async ({ app, page }) => {
      await connectTestAccount(page);
      await putGrowthRows(page, { ratingDays: ratingDays() });
      await app.goto();
      await app.startBlankProject();
    });

    test('Ratings shows the record Growth keeps: new ratings by stars, the countries and the version', async ({ page, tauri }) => {
      const view = await openApp(page);
      await section(view, 'Ratings').click();
      const ratings = view.getByTestId('growth-ratings');
      // The average of every country, weighted by its ratings.
      const rows = sampleRatings();
      const total = rows.reduce((sum, row) => sum + row.count, 0);
      const average = rows.reduce((sum, row) => sum + row.average * row.count, 0) / total;
      await expect(ratings.getByTestId('growth-ratings-average')).toHaveText(average.toFixed(1));
      await expect(ratings.getByText(`${total.toLocaleString('en-US')} ratings in ${rows.length} countries`)).toBeVisible();
      // Ten new in the US and two in Great Britain, from the two days kept.
      await expect(ratings.getByTestId('growth-ratings-new')).toHaveText('12');

      await ratings.getByRole('button', { name: 'New ratings', exact: true }).click();
      const legend = ratings.getByRole('list', { name: 'Legend' });
      await expect(legend).toContainText('5 stars');
      // Great Britain's page was not read, so its two have no stars.
      await expect(legend).toContainText('Stars not known');

      const table = ratings.getByTestId('growth-ratings-countries');
      await expect(table.locator('tbody tr').first()).toContainText('United States');
      await expect(table.locator('tbody tr').first()).toContainText('10');
      await table.getByRole('row', { name: /United Kingdom/ }).click();
      await expect(ratings.getByRole('combobox', { name: 'Country' })).toHaveText('United Kingdom');
      await expect(ratings.getByTestId('growth-ratings-new')).toHaveText('2');

      // The versions table: 10 new ratings while 2.4 was on sale, 4.2 stars on average.
      const version = ratings.getByTestId('growth-health-versions').locator('tr[data-version="2.4"]');
      await expect(version.locator('td').nth(2)).toHaveText('10 ratings, 4.2 stars');
      expect(await tauri.unhandled()).toEqual([]);
    });

    test('the inbox: the keys, a tag, and a review marked done, which outlast a reload', async ({ app, page }) => {
      let view = await openApp(page);
      await section(view, 'Reviews').click();
      const tabs = view.getByRole('group', { name: 'Show reviews' });
      const toDo = tabs.getByRole('button', { name: /^To do/ });
      await expect(toDo).toHaveAttribute('aria-pressed', 'true');
      const before = Number((await toDo.innerText()).replace(/\D/g, ''));

      // J moves to the first review, R opens its reply box.
      const first = view.locator('[data-review-id]').first();
      const firstId = await first.getAttribute('data-review-id');
      await page.keyboard.press('j');
      await expect.poll(() => page.evaluate(() => document.activeElement?.closest('[data-review-id]')?.getAttribute('data-review-id'))).toBe(firstId);
      await page.keyboard.press('r');
      await expect(first.getByRole('textbox', { name: 'Reply' })).toBeFocused();
      await first.getByRole('button', { name: 'Cancel' }).click();

      const card = view.locator(`[data-review-id="${CRASH.id}"]`);
      await card.getByRole('button', { name: 'Tag the review' }).click();
      await page.getByRole('textbox', { name: 'New tag' }).fill('Bug');
      await page.getByRole('button', { name: 'Make the tag' }).click();
      await page.keyboard.press('Escape');
      await expect(card.getByText('Bug', { exact: true })).toBeVisible();

      await card.getByRole('button', { name: 'Done', exact: true }).click();
      // It stays in view until the filters change, with its new state.
      await expect(card).toHaveAttribute('data-review-status', 'done');
      await expect(toDo).toContainText(String(before - 1));

      await app.goto();
      await app.dismissStartDialog();
      view = await openApp(page);
      await section(view, 'Reviews').click();
      await expect(view.locator(`[data-review-id="${CRASH.id}"]`)).toHaveCount(0);
      await view.getByRole('group', { name: 'Show reviews' }).getByRole('button', { name: /^Done/ }).click();
      await expect(view.locator(`[data-review-id="${CRASH.id}"]`)).toContainText('Bug');
      await view.getByRole('combobox', { name: 'Filter by tag' }).click();
      await page.getByRole('option', { name: 'Bug' }).click();
      await expect(view.locator('[data-review-id]')).toHaveCount(1);
    });

    test('a template from Replies fills a reply with the reviewer’s name, and counts its use', async ({ page }) => {
      const view = await openApp(page);
      await section(view, 'Replies').click();
      await view.getByRole('button', { name: 'New template' }).click();
      await view.getByRole('textbox', { name: 'Template name' }).fill('Crash fix');
      await view.getByRole('textbox', { name: 'Template text' }).fill('Hi {name}, version 2.5 of {app} fixes the crash.');
      await view.getByRole('button', { name: 'Save template' }).click();
      await expect(view.getByTestId('growth-templates')).toContainText('Not used yet');

      await section(view, 'Reviews').click();
      const card = view.locator(`[data-review-id="${CRASH.id}"]`);
      await card.getByRole('button', { name: 'Templates' }).click();
      await page.getByRole('menuitem', { name: /Crash fix/ }).click();
      await expect(card.getByRole('textbox', { name: 'Reply' })).toHaveValue(`Hi ${CRASH.nickname}, version 2.5 of ${TEST_APP.name} fixes the crash.`);

      await section(view, 'Replies').click();
      await expect(view.getByTestId('growth-templates')).toContainText('Used once');
    });

    test('Every app puts the Google Play app’s reviews beside the App Store app’s, each with its own store', async ({ app, page }) => {
      const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
      await page.evaluate(
        ({ appstoreKey, serviceAccountJson, packageName }) => {
          const stored = JSON.parse(localStorage.getItem('open-screenshot-generator.store-credentials') ?? '{}');
          localStorage.setItem(
            'open-screenshot-generator.store-credentials',
            JSON.stringify({ ...stored, appstore: { ...stored.appstore, privateKey: appstoreKey }, playstore: { serviceAccountJson, packageName } })
          );
        },
        {
          appstoreKey: TEST_KEY,
          serviceAccountJson: JSON.stringify({ type: 'service_account', project_id: 'pebble', client_email: 'growth@pebble.iam.gserviceaccount.com', private_key: key, token_uri: 'https://oauth2.googleapis.com/token' }),
          packageName: PLAY_PACKAGE,
        }
      );
      await putGrowthRows(page, {
        reviews: [
          { id: 'gp:pebble-1', appId: `play:${PLAY_PACKAGE}`, rating: 2, title: '', body: 'The sync lost my notes.', nickname: 'A Google user', createdDate: `${day(-1)}T08:00:00Z`, territory: 'ZZ', language: 'en-GB' },
        ],
      });
      await app.goto();
      await app.dismissStartDialog();
      const view = await openApp(page);
      await section(view, 'Reviews').click();
      await expect(view.locator('[data-review-id="gp:pebble-1"]')).toHaveCount(0);
      await view.getByRole('group', { name: 'Which apps' }).getByRole('button', { name: 'Every app' }).click();
      const play = view.locator('[data-review-id="gp:pebble-1"]');
      await expect(play).toContainText(PLAY_PACKAGE);
      await expect(play).toContainText('in British English');
      await play.getByRole('button', { name: 'Reply', exact: true }).click();
      await expect(play.getByText('Replies are public. Google Play shows each reply under the review.')).toBeVisible();
      await expect(view.locator(`[data-review-id="${CRASH.id}"]`)).toContainText(TEST_APP.name);
    });

    test('a review whose stars went up after the reply says so, and Replies counts it', async ({ app, page }) => {
      await putGrowthRows(page, {
        reviews: [
          {
            ...CRASH,
            rating: 4,
            response: { id: 'resp-1', body: 'Version 2.5 fixes the crash.', lastModified: `${day(-3)}T10:00:00Z`, state: 'PUBLISHED' },
            ratingChanges: [{ from: 1, to: 4, at: Date.now() - 86_400_000 }],
          },
        ],
      });
      await app.goto();
      await app.dismissStartDialog();
      const view = await openApp(page);
      await section(view, 'Reviews').click();
      await view.getByRole('group', { name: 'Show reviews' }).getByRole('button', { name: /^All reviews/ }).click();
      await view.getByRole('button', { name: 'Stars changed' }).click();
      await expect(view.locator('[data-review-id]')).toHaveCount(1);
      await expect(view.locator(`[data-review-id="${CRASH.id}"]`)).toContainText('Changed from 1 to 4 stars after your reply');
      await section(view, 'Replies').click();
      await expect(view.getByTestId('growth-reply-stats')).toContainText('1 review went up');
    });

    test('Export CSV saves the reviews on the list as a file', async ({ page, tauri }) => {
      const view = await openApp(page);
      await section(view, 'Reviews').click();
      await view.getByRole('button', { name: 'Export CSV' }).first().click();
      const [file] = await tauri.waitForFiles(1);
      expect(file.path).toMatch(/reviews \d{4}-\d{2}-\d{2}\.csv$/);
      expect(file.bytes).toBeGreaterThan(1000);
    });

    test('Competitor reviews reads Apple’s public reviews and what people complain about', async ({ app, page }) => {
      await followRival(page);
      await app.goto();
      await app.dismissStartDialog();
      const view = await openApp(page);
      await section(view, 'Competitor reviews').click();
      const screen = view.getByTestId('growth-rival-reviews');
      for (const entry of RIVAL_REVIEWS) await expect(screen.locator(`[data-rival-review="${entry.id}"]`)).toContainText(entry.body);
      await expect(screen.getByText('What people complain about')).toBeVisible();
      // One of the two low reviews is about ads, one about crashes.
      await expect(screen.getByText('Ads', { exact: true })).toBeVisible();
      await expect(screen.getByText('Crashes', { exact: true })).toBeVisible();
      await screen.getByRole('combobox', { name: 'Filter by stars' }).click();
      await page.getByRole('option', { name: '4 and 5 stars' }).click();
      await expect(screen.locator('[data-rival-review]')).toHaveCount(1);
      const asked = (await httpRequests(page)).filter((request) => request.url.includes('/rss/customerreviews/'));
      expect(asked).toHaveLength(1);
    });

    test('Slack gets a test message from Replies, as JSON text', async ({ page }) => {
      const view = await openApp(page);
      await section(view, 'Replies').click();
      const alerts = view.getByTestId('growth-alerts');
      await alerts.getByRole('textbox').fill('https://example.com/not-slack');
      await expect(alerts.getByText('A Slack webhook address starts with https://hooks.slack.com/services/')).toBeVisible();
      await alerts.getByRole('textbox').fill(SLACK);
      await alerts.getByRole('button', { name: 'Save' }).click();
      await expect(alerts.getByRole('button', { name: 'Saved' })).toBeVisible();
      await alerts.getByRole('button', { name: 'Send a test message' }).click();
      await expect(alerts.getByText('Sent. Look for the message in Slack')).toBeVisible();
      const posted = (await httpRequests(page)).find((request) => request.method === 'POST' && request.url === SLACK);
      expect(JSON.parse(posted!.body!)).toEqual({ text: `Growth in Open Screenshot Generator will post new reviews of ${TEST_APP.name} here.` });
      await alerts.getByRole('radio', { name: 'Only 1 and 2 star reviews' }).click();
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('open-screenshot-generator.growth') ?? '{}'))).toMatchObject({ slackWebhook: SLACK, reviewAlerts: 'low' });
    });

    test.describe('with Claude Code signed in', () => {
      test.use({ tauriConfig: { http: [...TEST_ACCOUNT_RULES, ...RIVAL_RULES], responses: { abs_claude_detect: CLAUDE_READY } } });

      test('the summary counts the reviews the AI named, leaves out an id it made up, and opens them in Reviews', async ({ page, tauri }) => {
        // The newest two reviews of the last 90 days are r1 and r2.
        const since = day(-89);
        const newest = sampleReviews()
          .filter((review) => review.createdDate.slice(0, 10) >= since)
          .sort((a, b) => b.createdDate.localeCompare(a.createdDate));
        await tauri.setResponse(
          'abs_claude_prompt',
          JSON.stringify({
            headline: 'People like the streaks, and the app crashes for some on launch',
            liked: [{ theme: 'Streaks', detail: 'People like keeping a streak.', reviews: ['r3'] }],
            disliked: [{ theme: 'Crashes on opening', detail: 'The app closes when it opens.', reviews: ['r1', 'r2', 'r999'] }],
            requests: [],
            ideas: ['Streaks that keep you going'],
          })
        );
        const view = await openApp(page);
        await section(view, 'Review summary').click();
        await view.getByRole('button', { name: 'Write summary' }).click();
        const card = view.getByTestId('growth-review-summary-card');
        await expect(card).toContainText('People like the streaks, and the app crashes for some on launch');
        const theme = card.locator('[data-summary-theme="Crashes on opening"]');
        await expect(theme).toContainText('2 reviews');
        await expect(theme).toContainText(newest[0].body);
        await expect(card.getByText('Lines for your screenshots')).toBeVisible();

        // A summary every week, which the background check writes when it is due.
        await view.getByRole('combobox', { name: 'Write a summary on its own' }).click();
        await page.getByRole('option', { name: 'Every week' }).click();
        await expect.poll(() => growthMeta(page, `reviews:summary-every:${TEST_APP.id}`)).toEqual({ every: 'week', appName: TEST_APP.name, own: true });

        const [prompt] = await tauri.callsTo('abs_claude_prompt');
        const args = prompt.args as { system: string; prompt: string };
        expect(args.prompt).toContain('<<<REVIEWS');
        expect(args.prompt).toContain('[r1]');
        expect(args.system).toContain('sort them into themes');

        await theme.getByRole('button', { name: 'Open the 2 reviews in Reviews' }).click();
        await expect(view.getByText(/^2 of \d+ reviews from the summary$/)).toBeVisible();
        await expect(view.locator('[data-review-id]')).toHaveCount(2);
        await expect(view.locator(`[data-review-id="${newest[0].id}"]`)).toBeVisible();
        await expect(view.locator(`[data-review-id="${newest[1].id}"]`)).toBeVisible();
      });
    });
  });
});
