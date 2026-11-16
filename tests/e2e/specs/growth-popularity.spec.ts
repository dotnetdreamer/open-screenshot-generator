import { generateKeyPairSync } from 'node:crypto';
import { test, expect, type Page } from '../fixtures/test';
import type { TauriHttpRule } from '../fixtures/tauri-runtime';
import { FakeAppStore, storeRow, type StoreRow } from '../helpers/appStore';
import { holdGrowthStore } from '../fixtures/db';
import { gateOf, openGrowth, putGrowthRows, section } from '../helpers/growth';

// Keyword popularity from Apple Ads (src/lib/growth/appleAds.ts, popularity.ts):
// connecting Apple Ads with a key the app makes, the score beside each rank,
// the sort, the map of popularity against the strength of the top 10, the
// keyword's own line and chart, and the ideas in best chance order. Apple's
// sign-in and Apple Ads answer no web page, so the web build shows the
// prompt with the reason, and asks nothing. On the desktop, tauri-plugin-http
// is answered by the harness: Apple's sign-in with a token, Apple Ads with
// the ad accounts and the rows of Apple's documented answer shape.

const YOUR_ID = 6797975644;
const KING_ID = 993090598;
const STAR_ID = 1198143062;

const you = (overrides: Partial<StoreRow> = {}) => storeRow({ trackId: YOUR_ID, trackName: 'Ludo Wala: 3D & Action', artistName: 'Idrees Khan', userRatingCount: 40, averageUserRating: 5, ...overrides });
const king = () => storeRow({ trackId: KING_ID, trackName: 'Ludo King', artistName: 'Gametion', userRatingCount: 19090, averageUserRating: 3.73 });
const star = () => storeRow({ trackId: STAR_ID, trackName: 'Ludo STAR', artistName: 'Gameberry Labs', userRatingCount: 12, averageUserRating: 4.5 });
const diceKing = () => storeRow({ trackId: 555000111, trackName: 'Dice King', artistName: 'Dice Co', userRatingCount: 300 });

const DAY_MS = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * The last whole weeks, Sunday to Saturday in UTC, oldest first: the Sunday
 * each starts on, and the Sunday after it, which Apple Ads names the week by
 * ("the date immediately following the completed weekly range").
 */
function lastWeeks(count: number): Array<{ start: string; named: string }> {
  const now = new Date();
  const lastSaturday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (now.getUTCDay() + 1));
  return Array.from({ length: count }, (_, index) => {
    const end = lastSaturday - (count - 1 - index) * 7 * DAY_MS;
    return { start: isoDay(end - 6 * DAY_MS), named: isoDay(end + DAY_MS) };
  });
}

/** A day as the screen writes it in the current year: "Nov 8". */
function dayWords(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][date.getUTCMonth()]} ${date.getUTCDate()}`;
}

const WEEKS = lastWeeks(8);
const row = (term: string, week: { named: string }, score: number, tier: number, genre = 'GAMES') => ({
  week: week.named,
  countryOrRegion: 'US',
  genre,
  searchTerm: term,
  searchPopularity1to100: score,
  searchPopularity1to5: tier,
});

/** Apple Ads' answer: "ludo" rising over eight weeks, in two genres; "ludo wala" one week; "ludo king" for the ideas. Nothing for "dice". */
const POPULARITY_ROWS = [
  ...WEEKS.map((week, index) => row('ludo', week, 45 + index * 2, 3)),
  ...WEEKS.map((week, index) => row('ludo', week, 44 + index * 2, 3, 'ENTERTAINMENT')),
  row('ludo wala', WEEKS[7], 12, 1),
  row('ludo king', WEEKS[7], 70, 4),
];

/** Nine apps, each with more ratings than yours, to fill the first ten for "king" beside Ludo King. */
const crowd = () => Array.from({ length: 9 }, (_, index) => storeRow({ trackId: 880_000_001 + index, trackName: `Crown Quest ${index + 1}`, artistName: 'Crown Co', userRatingCount: 500 + index }));

const ACCOUNT = { id: 123456789, name: 'Ludo Wala Ads', orgId: 27154130 };

const ADS_RULES: TauriHttpRule[] = [
  {
    match: '^POST https://appleid\\.apple\\.com/auth/oauth2/token$',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ access_token: 'e2e-ads-token', token_type: 'Bearer', expires_in: 3600, scope: 'searchadsorg' }),
  },
  {
    match: '^GET https://api\\.ads\\.apple\\.com/v1/acls$',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ result: { acls: [{ adAccount: ACCOUNT, roles: ['API Account Read Only'] }] } }),
  },
  {
    match: '^POST https://api\\.ads\\.apple\\.com/v1/insights/apps/search-term-popularity/query$',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ result: { rows: POPULARITY_ROWS }, pagination: { offset: 0, pageSize: 2000 } }),
  },
];

/** The same, with the ad accounts held until the test calls releaseHttp(): a connection that waits on Apple Ads. */
const ACCOUNTS_HELD: TauriHttpRule[] = ADS_RULES.map((rule) => (rule.match.includes('/v1/acls') ? { ...rule, hold: true } : rule));

const SETUP_KEY = 'open-screenshot-generator.apple-ads';

/** Two ad accounts, so the dialog offers a pick. */
const ACCOUNT_B = { id: 223344556, name: 'Ludo Wala Ads EU', orgId: 27154130 };
const TWO_ACCOUNTS: TauriHttpRule[] = ADS_RULES.map((rule) =>
  rule.match.includes('/v1/acls')
    ? { ...rule, body: JSON.stringify({ result: { acls: [ACCOUNT, ACCOUNT_B].map((adAccount) => ({ adAccount, roles: ['API Account Read Only'] })) } }) }
    : rule
);

/** Connect from the Keywords prompt with a key the app makes, on an Apple Ads user with two ad accounts; the dialog stays open on its success. */
async function connectWithTwoAccounts(app: { startBlankProject(): Promise<unknown> }, page: Page, isDesktop: boolean) {
  await setUp(page, isDesktop, TWO_ACCOUNTS);
  await app.startBlankProject();
  const view = await openGrowth(page);
  await section(view, 'Keywords').click();
  await page.getByTestId('growth-keywords').getByTestId('growth-popularity-prompt').getByRole('button', { name: 'Connect Apple Ads' }).click();
  const dialog = page.getByTestId('apple-ads-dialog');
  await dialog.getByRole('button', { name: 'Make a key' }).click();
  await expect(dialog.getByTestId('apple-ads-public-key')).toContainText('-----BEGIN PUBLIC KEY-----');
  await dialog.getByRole('textbox', { name: 'IDs from Apple Ads' }).fill(IDS);
  await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Connected to Ludo Wala Ads');
  await expect(dialog.getByRole('combobox', { name: 'Ad account' })).toBeVisible();
  return dialog;
}

/** Another window's key and ad account, as it would save them: its own IDs and private key. */
function otherWindowSetup() {
  const { key } = savedSetup();
  return {
    key: { ...key, clientId: 'SEARCHADS.other-window-client', teamId: 'SEARCHADS.other-window-team', keyId: 'other-window-key' },
    account: { id: '998877665', name: 'Another Ads account', roles: ['API Account Read Only'] },
  };
}

const releaseHttp = (page: Page) => page.evaluate(() => (window as unknown as { __E2E_TAURI__: { releaseHttp(): number } }).__E2E_TAURI__.releaseHttp());

/** A key connected before, as GrowthAppleAds.tsx saves it. */
function savedSetup() {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1', privateKeyEncoding: { format: 'pem', type: 'pkcs8' }, publicKeyEncoding: { format: 'pem', type: 'spki' } });
  return {
    key: { clientId: 'SEARCHADS.e2e-client', teamId: 'SEARCHADS.e2e-team', keyId: 'e2e-key', privateKeyPem: pair.privateKey, publicKeyPem: pair.publicKey },
    account: { id: String(ACCOUNT.id), name: ACCOUNT.name, roles: ['API Account Read Only'] },
  };
}

/** The three lines Apple Ads shows after the public key is saved, as Apple's guide prints them. */
const IDS = 'clientId SEARCHADS.aeb3ef5f-0c5a-4f2a-99c8-fca83f25a9\nteamId SEARCHADS.hgw3ef3p-0w7a-8a2n-77c8-scv83f25a7\nkeyId a273d0d3-4d9e-458c-a173-0db8619ca7d7';

/** The keywords tracked before, with the user's app named on Competitors: no store key needed. */
const SEEDED = [
  {
    key: 'rivals:list:',
    value: {
      owner: '',
      rivals: [{ id: String(KING_ID), name: 'Ludo King', developer: 'Gametion', iconUrl: null, addedAt: 1 }],
      countries: ['US'],
      yourApp: { id: String(YOUR_ID), name: 'Ludo Wala: 3D & Action', developer: 'Idrees Khan', iconUrl: null, addedAt: 1 },
      checkedAt: Date.now(),
    },
  },
  {
    key: 'keywords:list:',
    value: {
      owner: '',
      keywords: ['ludo', 'ludo wala', 'dice'].map((term) => ({ term, addedAt: 1, source: 'typed' })),
      countries: ['US'],
    },
  },
];

interface Sent {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
}

async function adsRequests(page: Page): Promise<Sent[]> {
  const all = await page.evaluate(() => (window as unknown as { __E2E_TAURI__: { httpRequests: Sent[] } }).__E2E_TAURI__.httpRequests);
  return all.filter((request) => /^https:\/\/(appleid\.apple\.com|api\.ads\.apple\.com)\//.test(request.url));
}

async function setUp(page: Page, isDesktop: boolean, rules: TauriHttpRule[] = ADS_RULES) {
  const store = new FakeAppStore(page, isDesktop, rules);
  await store.install();
  await store.sell('us', [you(), king(), star()]);
  await store.searchLists('us', 'ludo', [king(), star(), you()]);
  await store.searchLists('us', 'ludo wala', [you(), king()]);
  // "Dice King" and "Ludo King" give the Top apps tab an idea, "king", so the table and the ideas both ask Apple Ads as Apple Ads connects.
  await store.searchLists('us', 'dice', [diceKing(), star(), king()]);
  // The ideas from the app followed. Your app is in neither search: "ludo king" has an app with fewer ratings than yours in its top 10, "king" has none.
  await store.searchLists('us', 'ludo king', [king(), star()]);
  await store.searchLists('us', 'king', [king(), ...crowd()]);
  await putGrowthRows(page, { meta: SEEDED });
  return store;
}

test.describe('growth keyword popularity', () => {
  test('the web build shows popularity is for the desktop app, and asks Apple Ads nothing', async ({ app, page, isDesktop }) => {
    test.skip(isDesktop, 'The web build only');
    const asked: string[] = [];
    page.on('request', (request) => {
      if (/appleid\.apple\.com|api\.ads\.apple\.com/.test(request.url())) asked.push(request.url());
    });
    await setUp(page, isDesktop);
    await app.startBlankProject();
    const view = await openGrowth(page);
    await section(view, 'Keywords').click();
    const prompt = page.getByTestId('growth-popularity-prompt');
    await expect(prompt).toContainText('See how popular each keyword is');
    const connect = prompt.getByRole('button', { name: 'Connect Apple Ads' });
    await expect(connect).toBeDisabled();
    await expect(gateOf(connect)).toHaveAttribute('data-gated-reason', 'Popularity needs the desktop app');
    // The table has no popularity column without Apple Ads.
    await expect(page.getByTestId('growth-keyword-table').getByRole('columnheader', { name: /Popularity/ })).toHaveCount(0);
    // The map says what it needs.
    await page.getByRole('group', { name: 'Show as' }).getByRole('button', { name: 'Map', exact: true }).click();
    await expect(page.getByTestId('growth-popularity-prompt')).toContainText('The map needs popularity from Apple Ads');
    // Setup has the same, disabled with the same reason.
    await section(view, 'Setup').click();
    const panel = page.getByTestId('growth-apple-ads');
    await expect(gateOf(panel.getByRole('button', { name: 'Connect Apple Ads' }))).toHaveAttribute('data-gated-reason', 'Popularity needs the desktop app');
    expect(asked).toEqual([]);
  });

  test('connecting Apple Ads with a key the app makes puts a popularity beside each rank, a map, and ideas in best chance order', async ({ app, page, isDesktop }) => {
    test.skip(!isDesktop, 'Apple Ads answers the desktop app only');
    await setUp(page, isDesktop);
    await app.startBlankProject();
    const view = await openGrowth(page);
    await section(view, 'Keywords').click();
    const screen = page.getByTestId('growth-keywords');
    const table = screen.getByTestId('growth-keyword-table');
    const rowOf = (term: string) => table.locator(`tr[data-keyword="${term}"]`);
    // The ranks come first, from the App Store search.
    await expect(rowOf('ludo wala').locator('td').nth(1)).toHaveText('Rank 1', { timeout: 30_000 });
    await expect(rowOf('dice').locator('td').nth(1)).toHaveText('Not found', { timeout: 30_000 });

    // Connect: make a key, paste the three ids Apple Ads shows, connect.
    const prompt = screen.getByTestId('growth-popularity-prompt');
    await expect(prompt).toContainText('See how popular each keyword is');
    await prompt.getByRole('button', { name: 'Connect Apple Ads' }).click();
    const dialog = page.getByTestId('apple-ads-dialog');
    await expect(dialog.getByRole('heading', { name: 'Connect Apple Ads' })).toBeVisible();
    const connect = dialog.getByRole('button', { name: 'Connect', exact: true });
    await expect(gateOf(connect)).toHaveAttribute('data-gated-reason', 'Make a key first');
    await dialog.getByRole('button', { name: 'Make a key' }).click();
    await expect(dialog.getByTestId('apple-ads-public-key')).toContainText('-----BEGIN PUBLIC KEY-----');
    // The key outlives the dialog: closed and opened again, the same public key shows.
    const publicKey = await dialog.getByTestId('apple-ads-public-key').innerText();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await prompt.getByRole('button', { name: 'Finish connecting Apple Ads' }).click();
    await expect(dialog.getByTestId('apple-ads-public-key')).toHaveText(publicKey);
    await expect(gateOf(connect)).toHaveAttribute('data-gated-reason', 'Paste the clientId, teamId and keyId from Apple Ads first');
    await dialog.getByRole('textbox', { name: 'IDs from Apple Ads' }).fill(IDS);
    const found = dialog.getByRole('list', { name: 'IDs found' });
    for (const label of ['Client ID', 'Team ID', 'Key ID']) await expect(found.getByRole('listitem').filter({ hasText: label })).toContainText('found');
    await connect.click();
    await expect(dialog.getByRole('status')).toContainText('Connected to Ludo Wala Ads');
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toBeHidden();
    await expect(prompt).toHaveCount(0);
    // The ideas on screen were asked about in the same moment as the table, and both got their scores.
    await expect(screen.getByTestId('growth-keyword-ideas').locator('[data-idea="king"] [data-popularity-cell]')).toHaveText('No score', { timeout: 15_000 });

    // What went to Apple: a client secret for a token, then the ad account's popularity, one request for the
    // three keywords and one for the idea on screen. The idea's goes first; the table's waits for it.
    const termsOf = (request: Sent): string[] => JSON.parse(request.body ?? '{}').filters?.find((filter: { field: string }) => filter.field === 'searchTerm')?.value ?? [];
    const queries = async () => (await adsRequests(page)).filter((request) => request.url.endsWith('/search-term-popularity/query'));
    await expect.poll(async () => (await queries()).map(termsOf), { timeout: 15_000 }).toEqual(expect.arrayContaining([['ludo', 'ludo wala', 'dice'], ['king']]));
    const sent = await adsRequests(page);
    const token = sent.find((request) => request.url === 'https://appleid.apple.com/auth/oauth2/token')!;
    const form = new URLSearchParams(token.body ?? '');
    expect(form.get('client_id')).toBe('SEARCHADS.aeb3ef5f-0c5a-4f2a-99c8-fca83f25a9');
    expect(form.get('scope')).toBe('searchadsorg');
    expect(form.get('client_secret')?.split('.')).toHaveLength(3);
    const query = (await queries()).find((request) => termsOf(request).includes('ludo'))!;
    expect(query.method).toBe('POST');
    expect(query.headers['authorization']).toBe('Bearer e2e-ads-token');
    expect(query.headers['x-ap-context']).toBe('adAccountId=123456789');
    const body = JSON.parse(query.body ?? '{}');
    expect(body.filters).toEqual([
      { field: 'countryOrRegion', operator: 'EQUALS', value: 'US' },
      { field: 'searchTerm', operator: 'IN', value: ['ludo', 'ludo wala', 'dice'] },
    ]);
    expect(body.timeRange.granularity).toBe('WEEKLY_SUN_SAT');
    expect(body.fields).toEqual(['searchPopularity1to100', 'searchPopularity1to5']);

    // The score beside each rank: the latest week, the highest genre's.
    await expect(table.getByRole('columnheader', { name: /Popularity/ })).toBeVisible();
    await expect(rowOf('ludo').locator('[data-popularity-cell]').getByRole('img')).toHaveAccessibleName('Popularity 59 of 100, medium');
    await expect(rowOf('ludo wala').locator('[data-popularity-cell]').getByRole('img')).toHaveAccessibleName('Popularity 12 of 100, very low');
    await expect(rowOf('dice').locator('[data-popularity-cell]')).toHaveText('No score');

    // Most searched first.
    await table.getByRole('columnheader', { name: /Popularity/ }).getByRole('button', { name: 'Popularity', exact: true }).click();
    await expect(table.locator('tbody tr')).toHaveCount(3);
    await expect(table.locator('tbody tr').nth(0)).toHaveAttribute('data-keyword', 'ludo');
    await expect(table.locator('tbody tr').nth(1)).toHaveAttribute('data-keyword', 'ludo wala');
    await expect(table.locator('tbody tr').nth(2)).toHaveAttribute('data-keyword', 'dice');

    // The map: popularity up the side, the weakest app of the top 10 along the bottom.
    await screen.getByRole('group', { name: 'Show as' }).getByRole('button', { name: 'Map', exact: true }).click();
    const map = screen.getByTestId('growth-keyword-map');
    // "ludo": Ludo STAR, with 12 ratings, is the weakest of the first ten besides yours.
    await expect(map.locator('[data-map-keyword="ludo"]')).toHaveAttribute('aria-label', 'ludo: popularity 59, fewest ratings in the top 10 12, your rank 3');
    await expect(map.locator('[data-map-keyword="ludo wala"]')).toHaveAttribute('aria-label', 'ludo wala: popularity 12, fewest ratings in the top 10 19,090, your rank 1');
    await expect(map).toContainText('Ludo Wala: 3D & Action: 40 ratings');
    await expect(map).toContainText('Not on the map, no popularity score from Apple Ads (1)');
    // A dot picks its keyword, with the pointer or the keyboard.
    await map.locator('[data-map-keyword="ludo wala"]').click();
    const detail = screen.getByTestId('growth-keyword-detail');
    await expect(detail).toContainText('"ludo wala"');
    await map.locator('[data-map-keyword="ludo"]').focus();
    await page.keyboard.press('Enter');
    await expect(detail).toContainText('"ludo"');
    await expect(map.locator('[data-map-keyword="ludo"]')).toHaveAttribute('aria-pressed', 'true');

    // The keyword's own line: the score, the tier, and the move over about a month.
    const line = detail.getByTestId('growth-keyword-popularity');
    await expect(line.getByRole('img')).toHaveAccessibleName('Popularity 59 of 100, medium');
    await expect(line).toContainText('Medium');
    // Apple named the last week by the Sunday after it; the screen names it by the Sunday it starts on,
    // and the move compares with the week four weeks before.
    await expect(line).toContainText(`Week of ${dayWords(WEEKS[7].start)}`);
    await expect(line).toContainText(`Up 8 since the week of ${dayWords(WEEKS[3].start)}`);
    await detail.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'Popularity', exact: true }).click();
    await expect(detail.getByRole('img', { name: 'Popularity of "ludo" in United States, week by week, from 1 to 100' })).toBeVisible();

    // Ideas come best chance first, each with its score: here, the words in the name of the app followed.
    const ideas = screen.getByTestId('growth-keyword-ideas');
    await ideas.getByRole('group', { name: 'Ideas from' }).getByRole('button', { name: 'Competitors', exact: true }).click();
    await expect(ideas.getByTestId('growth-idea-tools')).toContainText('Best chance first');
    const idea = (term: string) => ideas.locator(`[data-idea="${term}"]`);
    await expect(idea('ludo king').locator('[data-popularity-cell]').getByRole('img')).toHaveAccessibleName('Popularity 70 of 100, high', { timeout: 15_000 });
    await expect(idea('king').locator('[data-popularity-cell]')).toHaveText('No score');
    // Not checked yet: the most searched first.
    await expect(ideas.locator('[data-idea]').first()).toHaveAttribute('data-idea', 'ludo king');
    // Check all searches each idea, and says which ones an app like yours can reach.
    await ideas.getByRole('button', { name: 'Check all', exact: true }).click();
    await expect(idea('ludo king')).toHaveAttribute('data-chance', 'reach', { timeout: 30_000 });
    await expect(idea('king')).toHaveAttribute('data-chance', 'crowded', { timeout: 30_000 });
    await expect(idea('ludo king')).toContainText('Within reach');
    await expect(idea('king')).toContainText('Crowded');
    await expect(ideas.locator('[data-idea]').first()).toHaveAttribute('data-idea', 'ludo king');
    await expect(ideas.getByRole('button', { name: 'Check all', exact: true })).toHaveCount(0);

    // Setup says what popularity is read through.
    await section(view, 'Setup').click();
    await expect(page.getByTestId('growth-apple-ads')).toContainText('Connected to Ludo Wala Ads');
  });

  test('Check all keeps its count and Stop until the last idea answers, without Apple Ads too', async ({ app, page, isDesktop }) => {
    const store = await setUp(page, isDesktop);
    await app.startBlankProject();
    const view = await openGrowth(page);
    await section(view, 'Keywords').click();
    const screen = page.getByTestId('growth-keywords');
    const table = screen.getByTestId('growth-keyword-table');
    // The tracked keywords are checked first, so the ideas' searches are the only ones left.
    await expect(table.locator('tr[data-keyword="ludo wala"] td').nth(1)).toHaveText('Rank 1', { timeout: 30_000 });
    await expect(table.locator('tr[data-keyword="dice"] td').nth(1)).toHaveText('Not found', { timeout: 30_000 });
    const ideas = screen.getByTestId('growth-keyword-ideas');
    await ideas.getByRole('group', { name: 'Ideas from' }).getByRole('button', { name: 'Competitors', exact: true }).click();
    const tools = ideas.getByTestId('growth-idea-tools');
    // The ideas' searches sent so far, answered or still waiting.
    const ideaSearches = async () =>
      (await store.requests()).filter((url) => url.pathname === '/search' && url.searchParams.get('limit') === '200' && ['ludo king', 'king'].includes(url.searchParams.get('term') ?? '')).length;
    await store.holdSearches();
    await ideas.getByRole('button', { name: 'Check all', exact: true }).click();
    await expect(tools.getByRole('status')).toHaveText('Checking 0 of 2');
    // The first search goes out after its turn at Apple's servers, and waits.
    await expect.poll(ideaSearches, { timeout: 15_000 }).toBe(1);
    // Its answer comes, and the second search waits: one idea is left, and the count and Stop stay.
    await store.releaseSearches();
    await store.holdSearches();
    await expect(tools.getByRole('status')).toHaveText('Checking 1 of 2', { timeout: 15_000 });
    await expect.poll(ideaSearches, { timeout: 15_000 }).toBe(2);
    await expect(tools.getByRole('status')).toHaveText('Checking 1 of 2');
    await expect(tools.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
    // On another tab, even one with no ideas, the count and Stop stay while the searches go on.
    await ideas.getByRole('group', { name: 'Ideas from' }).getByRole('button', { name: 'AI', exact: true }).click();
    await expect(ideas.locator('[data-idea]')).toHaveCount(0);
    await expect(tools.getByRole('status')).toHaveText('Checking 1 of 2');
    await expect(tools.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
    await store.releaseSearches();
    await expect(tools).toHaveCount(0, { timeout: 15_000 });
    await ideas.getByRole('group', { name: 'Ideas from' }).getByRole('button', { name: 'Competitors', exact: true }).click();
    await expect(ideas.locator('[data-idea="ludo king"]')).toHaveAttribute('data-chance', 'reach', { timeout: 15_000 });
    await expect(ideas.locator('[data-idea="king"]')).toHaveAttribute('data-chance', 'crowded', { timeout: 15_000 });
    // Done, and nothing left to check: without popularity's sort note, the tools go.
    await expect(tools).toHaveCount(0);
    await expect(ideas.getByRole('button', { name: 'Check all', exact: true })).toHaveCount(0);
  });

  test('closing the dialog while Apple Ads answers drops the connection, and the key made stays ready', async ({ app, page, isDesktop }) => {
    test.skip(!isDesktop, 'Apple Ads answers the desktop app only');
    await setUp(page, isDesktop, ACCOUNTS_HELD);
    await app.startBlankProject();
    const view = await openGrowth(page);
    await section(view, 'Keywords').click();
    const prompt = page.getByTestId('growth-keywords').getByTestId('growth-popularity-prompt');
    await prompt.getByRole('button', { name: 'Connect Apple Ads' }).click();
    const dialog = page.getByTestId('apple-ads-dialog');
    await dialog.getByRole('button', { name: 'Make a key' }).click();
    await expect(dialog.getByTestId('apple-ads-public-key')).toContainText('-----BEGIN PUBLIC KEY-----');
    await dialog.getByRole('textbox', { name: 'IDs from Apple Ads' }).fill(IDS);
    await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect.poll(async () => (await adsRequests(page)).some((request) => request.url.endsWith('/v1/acls'))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    // Apple Ads answers after the dialog closed.
    expect(await page.evaluate(() => (window as unknown as { __E2E_TAURI__: { releaseHttp(): number } }).__E2E_TAURI__.releaseHttp())).toBe(1);
    await page.waitForTimeout(1_500);
    // Nothing was saved: the key made is still a draft, and the prompt offers to finish.
    await expect(prompt.getByRole('button', { name: 'Finish connecting Apple Ads' })).toBeVisible();
    const kept = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}'), SETUP_KEY);
    expect(kept.key).toBeUndefined();
    expect(kept.draft?.privateKeyPem).toContain('PRIVATE KEY');
    // Opened again, the dialog has the IDs and can connect, not "Connecting" from before.
    await prompt.getByRole('button', { name: 'Finish connecting Apple Ads' }).click();
    await expect(dialog.getByRole('textbox', { name: 'IDs from Apple Ads' })).toHaveValue(IDS);
    await expect(dialog.getByRole('button', { name: 'Connect', exact: true })).toBeEnabled();
  });

  test('a connection still waiting when the dialog closes saves nothing, so Disconnect stays done', async ({ app, page, isDesktop }) => {
    test.skip(!isDesktop, 'Apple Ads answers the desktop app only');
    await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: SETUP_KEY, value: savedSetup() });
    await page.reload();
    await setUp(page, isDesktop, ACCOUNTS_HELD);
    await app.startBlankProject();
    const view = await openGrowth(page);
    await section(view, 'Setup').click();
    const panel = page.getByTestId('growth-apple-ads');
    await expect(panel).toContainText('Connected to Ludo Wala Ads');
    await panel.getByRole('button', { name: 'Change key', exact: true }).click();
    const dialog = page.getByTestId('apple-ads-dialog');
    await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Connecting', exact: true })).toBeVisible();
    await expect.poll(async () => (await adsRequests(page)).some((request) => request.url.endsWith('/v1/acls'))).toBe(true);
    // The user gives up on it, and removes the key.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await panel.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await panel.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(panel.getByRole('button', { name: 'Connect Apple Ads', exact: true })).toBeVisible();
    // Then Apple Ads answers the connection.
    expect(await page.evaluate(() => (window as unknown as { __E2E_TAURI__: { releaseHttp(): number } }).__E2E_TAURI__.releaseHttp())).toBe(1);
    // Nothing on screen changes when the fix holds, so give a late save time to land before looking.
    await page.waitForTimeout(1_500);
    await expect(panel.getByRole('button', { name: 'Connect Apple Ads', exact: true })).toBeVisible();
    await expect(panel).not.toContainText('Connected to');
    expect(await page.evaluate((key) => localStorage.getItem(key), SETUP_KEY)).toBeNull();
  });

  test("an idea uses the same rating count for your app as the map: a search's, not an older stored one", async ({ app, page, isDesktop }) => {
    const store = await setUp(page, isDesktop);
    // The last Competitors check stored 3 ratings for your app; the searches made since show 40.
    await putGrowthRows(page, {
      meta: [{ key: `rivals:app:${YOUR_ID}`, value: { id: String(YOUR_ID), checkedAt: 1, countries: { US: { territory: 'US', name: 'Ludo Wala: 3D & Action', developer: 'Idrees Khan', genre: 'Games', version: '1.0', releasedAt: null, releaseNotes: '', rating: 5, ratingCount: 3, price: 0, priceLabel: 'Free', currency: 'USD', iconUrl: null, screenshots: [], ipadScreenshots: [], storeUrl: null, seenAt: 1 } } } }],
    });
    // "king": ten apps, your app not among them, the weakest with 12 ratings: fewer than your 40, more than the old 3.
    await store.searchLists('us', 'king', [star(), ...crowd()]);
    await app.startBlankProject();
    const view = await openGrowth(page);
    await section(view, 'Keywords').click();
    const screen = page.getByTestId('growth-keywords');
    await expect(screen.getByTestId('growth-keyword-table').locator('tr[data-keyword="dice"] td').nth(1)).toHaveText('Not found', { timeout: 30_000 });
    const ideas = screen.getByTestId('growth-keyword-ideas');
    await ideas.getByRole('group', { name: 'Ideas from' }).getByRole('button', { name: 'Competitors', exact: true }).click();
    await ideas.locator('[data-idea="king"]').getByRole('button', { name: 'Check king', exact: true }).click();
    await expect(ideas.locator('[data-idea="king"]')).toHaveAttribute('data-chance', 'reach', { timeout: 30_000 });
    await expect(ideas.locator('[data-idea="king"]')).toContainText('Within reach');
  });

  test('a connection that comes back after another window removed the key saves nothing, even when this window missed the news', async ({ app, page, isDesktop }) => {
    test.skip(!isDesktop, 'Apple Ads answers the desktop app only');
    await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: SETUP_KEY, value: savedSetup() });
    await page.reload();
    await setUp(page, isDesktop, ACCOUNTS_HELD);
    await app.startBlankProject();
    const view = await openGrowth(page);
    await section(view, 'Setup').click();
    const panel = page.getByTestId('growth-apple-ads');
    await expect(panel).toContainText('Connected to Ludo Wala Ads');
    await panel.getByRole('button', { name: 'Change key', exact: true }).click();
    const dialog = page.getByTestId('apple-ads-dialog');
    await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect.poll(async () => (await adsRequests(page)).some((request) => request.url.endsWith('/v1/acls'))).toBe(true);
    // Another window removes the key, and this window never hears of it: no storage event.
    await page.evaluate((key) => localStorage.removeItem(key), SETUP_KEY);
    expect(await releaseHttp(page)).toBe(1);
    await expect(dialog.getByRole('alert')).toHaveText('Another window changed Apple Ads while this one was connecting, so nothing was saved');
    expect(await page.evaluate((key) => localStorage.getItem(key), SETUP_KEY)).toBeNull();
  });

  test('a form opened for one key offers no Connect once another window saved a different key, and shows that key on request', async ({ app, page, isDesktop }) => {
    test.skip(!isDesktop, 'Apple Ads answers the desktop app only');
    await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: SETUP_KEY, value: savedSetup() });
    await page.reload();
    await setUp(page, isDesktop);
    await app.startBlankProject();
    const view = await openGrowth(page);
    await section(view, 'Setup').click();
    await page.getByTestId('growth-apple-ads').getByRole('button', { name: 'Change key', exact: true }).click();
    const dialog = page.getByTestId('apple-ads-dialog');
    await expect(dialog.getByRole('button', { name: 'Connect', exact: true })).toBeEnabled();
    // Before any Connect, another window saves its own key, and this window hears of it.
    const replacement = otherWindowSetup();
    await page.evaluate(({ key, value }) => {
      localStorage.setItem(key, JSON.stringify(value));
      window.dispatchEvent(new StorageEvent('storage', { key }));
    }, { key: SETUP_KEY, value: replacement });
    const changed = dialog.getByTestId('apple-ads-key-changed');
    await expect(changed).toContainText('Another window connected a different Apple Ads key');
    await expect(dialog.getByRole('button', { name: 'Connect', exact: true })).toHaveCount(0);
    await changed.getByRole('button', { name: 'Show that key' }).click();
    await expect(dialog.getByRole('textbox', { name: 'IDs from Apple Ads' })).toHaveValue(`clientId ${replacement.key.clientId}\nteamId ${replacement.key.teamId}\nkeyId ${replacement.key.keyId}`);
    await expect(dialog.getByTestId('apple-ads-public-key')).toHaveText(replacement.key.publicKeyPem.trim());
    await expect(dialog.getByRole('button', { name: 'Connect', exact: true })).toBeEnabled();
    expect((await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}'), SETUP_KEY)).key?.privateKeyPem).toBe(replacement.key.privateKeyPem);
  });

  test('Connect on a form opened for one key asks Apple nothing when another window saved a different key unheard', async ({ app, page, isDesktop }) => {
    test.skip(!isDesktop, 'Apple Ads answers the desktop app only');
    await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: SETUP_KEY, value: savedSetup() });
    await page.reload();
    await setUp(page, isDesktop);
    await app.startBlankProject();
    const view = await openGrowth(page);
    await section(view, 'Setup').click();
    await page.getByTestId('growth-apple-ads').getByRole('button', { name: 'Change key', exact: true }).click();
    const dialog = page.getByTestId('apple-ads-dialog');
    // Another window saves its own key, and this window never hears of it: the old key and IDs stay on screen.
    const replacement = otherWindowSetup();
    await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: SETUP_KEY, value: replacement });
    await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
    // Connect read storage first: nothing goes to Apple Ads, and the dialog says why.
    await expect(dialog.getByTestId('apple-ads-key-changed')).toContainText('Another window connected a different Apple Ads key');
    await page.waitForTimeout(1_000);
    expect((await adsRequests(page)).filter((request) => request.url.endsWith('/v1/acls'))).toHaveLength(0);
    const kept = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}'), SETUP_KEY);
    expect(kept.key?.privateKeyPem).toBe(replacement.key.privateKeyPem);
    expect(kept.account?.id).toBe('998877665');
  });

  test("the ad accounts listed for one key are never offered once another window saved a different key", async ({ app, page, isDesktop }) => {
    test.skip(!isDesktop, 'Apple Ads answers the desktop app only');
    const dialog = await connectWithTwoAccounts(app, page, isDesktop);
    const replacement = otherWindowSetup();
    await page.evaluate(({ key, value }) => {
      localStorage.setItem(key, JSON.stringify(value));
      window.dispatchEvent(new StorageEvent('storage', { key }));
    }, { key: SETUP_KEY, value: replacement });
    await expect(dialog.getByRole('combobox', { name: 'Ad account' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Connect', exact: true })).toHaveCount(0);
    const changed = dialog.getByTestId('apple-ads-key-changed');
    await expect(changed).toContainText('Another window connected a different Apple Ads key');
    // Show that key: the IDs and the public key are the saved key's, ready to connect again.
    await changed.getByRole('button', { name: 'Show that key' }).click();
    await expect(dialog.getByRole('textbox', { name: 'IDs from Apple Ads' })).toHaveValue(`clientId ${replacement.key.clientId}\nteamId ${replacement.key.teamId}\nkeyId ${replacement.key.keyId}`);
    await expect(dialog.getByTestId('apple-ads-public-key')).toHaveText(replacement.key.publicKeyPem.trim());
    await expect(dialog.getByRole('button', { name: 'Connect', exact: true })).toBeEnabled();
    const kept = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}'), SETUP_KEY);
    expect(kept.account?.id).toBe('998877665');
    expect(kept.key?.privateKeyPem).toBe(replacement.key.privateKeyPem);
  });

  test('an ad account picked from a list this window still shows saves nothing when another window saved a different key unheard', async ({ app, page, isDesktop }) => {
    test.skip(!isDesktop, 'Apple Ads answers the desktop app only');
    const dialog = await connectWithTwoAccounts(app, page, isDesktop);
    // Another window saves its key and account, and this window never hears of it: the old list stays on screen.
    const replacement = otherWindowSetup();
    await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: SETUP_KEY, value: replacement });
    await dialog.getByRole('combobox', { name: 'Ad account' }).click();
    await page.getByRole('option', { name: 'Ludo Wala Ads EU' }).click();
    // The pick reads storage first: nothing is saved, and the list goes.
    await expect(dialog.getByTestId('apple-ads-key-changed')).toContainText('Another window connected a different Apple Ads key');
    await expect(dialog.getByRole('combobox', { name: 'Ad account' })).toHaveCount(0);
    await page.waitForTimeout(1_000);
    const kept = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}'), SETUP_KEY);
    expect(kept.account?.id).toBe('998877665');
    expect(kept.key?.privateKeyPem).toBe(replacement.key.privateKeyPem);
  });

  test('an ad account picked while the database is busy never lands on a key another window saved meanwhile', async ({ app, page, isDesktop }) => {
    test.skip(!isDesktop, 'Apple Ads answers the desktop app only');
    const dialog = await connectWithTwoAccounts(app, page, isDesktop);
    // The pick waits on the database, and meanwhile another window saves a key and account of its own.
    const hold = await holdGrowthStore(page);
    await dialog.getByRole('combobox', { name: 'Ad account' }).click();
    await page.getByRole('option', { name: 'Ludo Wala Ads EU' }).click();
    const replacement = otherWindowSetup();
    await page.evaluate(({ key, value }) => {
      localStorage.setItem(key, JSON.stringify(value));
      window.dispatchEvent(new StorageEvent('storage', { key }));
    }, { key: SETUP_KEY, value: replacement });
    // The accounts listed belong to the old key: they go, and the dialog says why.
    await expect(dialog.getByRole('combobox', { name: 'Ad account' })).toHaveCount(0);
    await expect(dialog.getByTestId('apple-ads-key-changed')).toContainText('Another window connected a different Apple Ads key');
    await hold.release();
    await expect(dialog.getByRole('alert')).toHaveText("Another window changed Apple Ads meanwhile, so the ad account wasn't changed");
    const kept = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}'), SETUP_KEY);
    expect(kept.account?.id).toBe('998877665');
    expect(kept.key?.privateKeyPem).toBe(replacement.key.privateKeyPem);
  });

  test('a connection that comes back after another window changed Apple Ads saves nothing, and says why', async ({ app, page, isDesktop }) => {
    test.skip(!isDesktop, 'Apple Ads answers the desktop app only');
    await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: SETUP_KEY, value: savedSetup() });
    await page.reload();
    await setUp(page, isDesktop, ACCOUNTS_HELD);
    await app.startBlankProject();
    const view = await openGrowth(page);
    await section(view, 'Setup').click();
    const panel = page.getByTestId('growth-apple-ads');
    await expect(panel).toContainText('Connected to Ludo Wala Ads');
    await panel.getByRole('button', { name: 'Change key', exact: true }).click();
    const dialog = page.getByTestId('apple-ads-dialog');
    await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect.poll(async () => (await adsRequests(page)).some((request) => request.url.endsWith('/v1/acls'))).toBe(true);
    // Another window disconnects meanwhile: this window hears it as a storage event.
    await page.evaluate((key) => {
      localStorage.removeItem(key);
      window.dispatchEvent(new StorageEvent('storage', { key }));
    }, SETUP_KEY);
    expect(await page.evaluate(() => (window as unknown as { __E2E_TAURI__: { releaseHttp(): number } }).__E2E_TAURI__.releaseHttp())).toBe(1);
    await expect(dialog.getByRole('alert')).toHaveText('Another window changed Apple Ads while this one was connecting, so nothing was saved');
    expect(await page.evaluate((key) => localStorage.getItem(key), SETUP_KEY)).toBeNull();
  });
});
