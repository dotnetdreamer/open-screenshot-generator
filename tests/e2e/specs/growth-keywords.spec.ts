import { test, expect, type Page } from '../fixtures/test';
import type { TauriHarness } from '../fixtures/tauri';
import { FakeAppStore, shotUrl, storeRow, type StoreRow } from '../helpers/appStore';
import { TEST_KEY, openGrowth, putGrowthRows, section } from '../helpers/growth';

// Growth's Keywords: where the user's App Store app shows up when people search
// the App Store, read from Apple's public search, which needs no key, so the
// screen works in the web build and on a desktop with no store key. Apple is
// answered by FakeAppStore: the page's fetch in the web build, the Tauri HTTP
// plugin on the desktop. Searches are spaced about 3 seconds apart in the app,
// as Apple asks, so these lists track two keywords.

const YOUR_ID = 6797975644;
const KING_ID = 993090598;
const STAR_ID = 1198143062;

const you = (overrides: Partial<StoreRow> = {}) =>
  storeRow({ trackId: YOUR_ID, trackName: 'Ludo Wala: 3D & Action', artistName: 'Idrees Khan', userRatingCount: 1, averageUserRating: 5, screenshotUrls: [1, 2, 3].map((n) => shotUrl(`you-${n}`)), ...overrides });
const king = (overrides: Partial<StoreRow> = {}) =>
  storeRow({ trackId: KING_ID, trackName: 'Ludo King', artistName: 'Gametion', userRatingCount: 19090, averageUserRating: 3.73, screenshotUrls: [1, 2, 3].map((n) => shotUrl(`king-${n}`)), ...overrides });
const star = (overrides: Partial<StoreRow> = {}) =>
  storeRow({ trackId: STAR_ID, trackName: 'Ludo STAR', artistName: 'Gameberry Labs', userRatingCount: 105175, averageUserRating: 4.5, ...overrides });

/** The day as Growth writes it: UTC, like every Growth day. */
function dayString(offset = 0): string {
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
}

function keywords(page: Page) {
  return page.getByTestId('growth-keywords');
}

/** The keyword searches the app sent: Keywords asks for 200 apps, the Competitors finder for 10. */
async function keywordSearches(store: FakeAppStore): Promise<URL[]> {
  return (await store.requests()).filter((url) => url.pathname === '/search' && url.searchParams.get('limit') === '200');
}

let mcpCalls = 0;

/** A tool call to the design server, as the app's own agent (`agent`) or another client sends it. */
async function mcpCall(tauri: TauriHarness, name: string, args: Record<string, unknown>, agent: boolean) {
  const id = ++mcpCalls;
  const callId = `keywords-call-${id}`;
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

/** The apps followed with no Growth app, with the user's own named on Competitors. */
const UNOWNED_RIVALS = {
  key: 'rivals:list:',
  value: {
    owner: '',
    rivals: [{ id: String(KING_ID), name: 'Ludo King', developer: 'Gametion', iconUrl: null, addedAt: 1 }],
    countries: ['US'],
    yourApp: { id: String(YOUR_ID), name: 'Ludo Wala: 3D & Action', developer: 'Idrees Khan', iconUrl: null, addedAt: 1 },
    checkedAt: Date.now(),
  },
};

test.describe('growth keywords', () => {
  test('with no key, the app named on Competitors gets its rank for each keyword in each country, with the apps that come first', async ({ app, page, isDesktop }) => {
    const store = new FakeAppStore(page, isDesktop);
    await store.install();
    // Lookups, for following an app from the search results.
    await store.sell('us', [you(), king(), star()]);
    await store.searchLists('us', 'ludo', [king(), star(), you()]);
    await store.searchLists('us', 'ludo wala', [you(), king()]);
    await store.searchLists('pk', 'ludo', [you(), king()]);
    await store.searchLists('pk', 'ludo wala', [king()]);
    // A list made before, checking the United States, with nothing tracked yet.
    await putGrowthRows(page, { meta: [UNOWNED_RIVALS, { key: 'keywords:list:', value: { owner: '', keywords: [], countries: ['US'] } }] });
    await app.startBlankProject();

    const view = await openGrowth(page);
    await section(view, 'Keywords').click();
    await expect(section(view, 'Keywords')).toHaveAttribute('aria-current', 'page');
    // Nothing here waits for a key, so the reason the other sections give is not shown.
    await expect(view.getByTestId('growth-no-app')).toHaveCount(0);
    const screen = keywords(page);
    await expect(screen).toContainText('Where Ludo Wala: 3D & Action shows up when people search the App Store on an iPhone');

    // The first keywords come from the app's name, or are typed.
    const start = screen.getByTestId('growth-keyword-start');
    for (const term of ['ludo', 'wala', 'ludo wala', '3d', 'action']) await expect(start.getByRole('button', { name: term, exact: true })).toBeVisible();
    await start.getByRole('textbox', { name: 'Keywords to track' }).fill('Ludo, "ludo wala"');
    await start.getByRole('button', { name: 'Track', exact: true }).click();

    const table = screen.getByTestId('growth-keyword-table');
    const row = (term: string) => table.locator(`tr[data-keyword="${term}"]`);
    // The second cell is the rank: "Rank 3" to a screen reader, "3" on screen.
    const rank = (term: string) => row(term).locator('td').nth(1);
    await expect(rank('ludo wala')).toHaveText('Rank 1', { timeout: 30_000 });
    await expect(rank('ludo')).toHaveText('Rank 3', { timeout: 30_000 });
    await expect(screen.getByText('Checked just now')).toBeVisible();
    // Best rank first.
    await expect(table.locator('tbody tr')).toHaveCount(2);
    await expect(table.locator('tbody tr').first()).toHaveAttribute('data-keyword', 'ludo wala');
    // The app followed on Competitors, where it ranks.
    await expect(row('ludo').getByTitle('Ludo King: rank 1')).toBeVisible();

    // One keyword up close: its rank and who comes first.
    await row('ludo').getByRole('button', { name: 'ludo', exact: true }).click();
    const detail = screen.getByTestId('growth-keyword-detail');
    await expect(detail).toContainText('"ludo"');
    await expect(detail).toContainText('United States, checked today');
    await detail.getByRole('button', { name: 'Search results', exact: true }).click();
    const results = detail.getByRole('list', { name: 'Search results for ludo' });
    await expect(results.getByRole('listitem')).toHaveCount(3);
    await expect(results.getByRole('listitem').nth(0)).toContainText('Ludo King');
    await expect(results.getByRole('listitem').nth(1)).toContainText('Ludo STAR');
    await expect(results.getByRole('listitem').nth(2)).toContainText('Ludo Wala: 3D & Action');
    await expect(results.getByRole('listitem').nth(2)).toContainText('You');
    await expect(results.getByRole('listitem').nth(0)).toContainText('Following');
    // Without a key there is no store page to check against, and the screen says why.
    await expect(detail).toContainText('Add your App Store Connect key under Setup to see your store page here.');

    // Following an app from the results: today's search lists it, so its rank
    // shows at once, without asking Apple again and without a false "Not found".
    const before = (await keywordSearches(store)).length;
    await results.getByRole('button', { name: 'Follow Ludo STAR' }).click();
    await expect(results.getByRole('listitem').nth(1)).toContainText('Following');
    await expect(row('ludo').getByTitle('Ludo STAR: rank 2')).toBeVisible();
    await expect(row('ludo').getByTitle('Ludo King: rank 1')).toBeVisible();
    expect((await keywordSearches(store)).length).toBe(before);

    // A second country searches every keyword there.
    const countries = screen.getByTestId('growth-keyword-countries');
    await countries.getByRole('combobox', { name: 'Add a country' }).click();
    await page.getByRole('option', { name: 'Pakistan', exact: true }).click();
    await expect(countries.getByRole('listitem')).toHaveText(['United States', 'Pakistan']);
    await screen.getByRole('tab', { name: 'Pakistan', exact: true }).click();
    await expect(rank('ludo')).toHaveText('Rank 1', { timeout: 30_000 });
    await expect(rank('ludo wala')).toHaveText('Not found', { timeout: 30_000 });

    // Each keyword was searched once in each country, for iPhone apps.
    const searches = await keywordSearches(store);
    expect(searches.map((url) => `${url.searchParams.get('country')} ${url.searchParams.get('term')}`).sort()).toEqual([
      'pk ludo',
      'pk ludo wala',
      'us ludo',
      'us ludo wala',
    ]);
    for (const url of searches) expect(url.searchParams.get('entity')).toBe('software');

    // A day with every rank in asks Apple nothing more, after a restart too.
    await app.goto();
    await store.install();
    await app.startBlankProject();
    const asked = (await keywordSearches(store)).length;
    const again = await openGrowth(page);
    await section(again, 'Keywords').click();
    await expect(rank('ludo')).toHaveText('Rank 3');
    await expect(rank('ludo wala')).toHaveText('Rank 1');
    await page.waitForTimeout(4000);
    expect((await keywordSearches(store)).length).toBe(asked);

    // Stopping keeps the other keyword.
    await row('ludo wala').getByRole('button', { name: 'ludo wala', exact: true }).click();
    await screen.getByTestId('growth-keyword-detail').getByRole('button', { name: 'Stop tracking' }).click();
    await expect(table.locator('tbody tr')).toHaveCount(1);
    await expect(screen.getByText('Stopped tracking "ludo wala"')).toBeVisible();
  });

  test('an idea checked in one country never shows its rank in another, however soon the country changes', async ({ app, page, isDesktop }) => {
    const store = new FakeAppStore(page, isDesktop);
    await store.install();
    await store.searchLists('us', 'board game', [king()]);
    await store.searchLists('pk', 'board game', [star(), you()]);
    // "ludo" is tracked in both countries, with today's ranks and searches in,
    // so opening the screen asks Apple nothing; two of the apps that rank put
    // "board game" in their names, which makes it an idea.
    const at = Date.now();
    const listed = (id: number, name: string) => ({ id: String(id), name, developer: 'E2E Games', iconUrl: null, rating: 4, ratingCount: 10, priceLabel: 'Free', genre: 'Games', screenshots: [] });
    const top = [listed(KING_ID, 'Ludo King'), listed(1001, 'Board Game Club'), listed(1002, 'Dice Board Game'), listed(YOUR_ID, 'Ludo Wala: 3D & Action')];
    const search = (country: string) => ({ key: `keywords:search:${country}:ludo`, value: { term: 'ludo', country, at, ids: top.map((entry) => entry.id), top } });
    const ranked = (country: string) => ({ key: `${YOUR_ID}|${country}|ludo|${dayString()}`, appId: String(YOUR_ID), term: 'ludo', country, date: dayString(), rank: 4, total: 4, rivals: { [String(KING_ID)]: 1 }, at });
    await putGrowthRows(page, {
      meta: [
        UNOWNED_RIVALS,
        { key: 'keywords:list:', value: { owner: '', keywords: [{ term: 'ludo', addedAt: 1, source: 'typed' }], countries: ['US', 'PK'], checkedAt: at } },
        search('US'),
        search('PK'),
      ],
      keywordDays: [ranked('US'), ranked('PK')],
    });
    await app.startBlankProject();

    const view = await openGrowth(page);
    await section(view, 'Keywords').click();
    const screen = keywords(page);
    const ideas = screen.getByTestId('growth-keyword-ideas');
    const idea = ideas.locator('li[data-idea="board game"]');
    await expect(idea).toContainText('In the names of 2 top apps');

    // The check goes out in the United States, and the country changes before Apple answers.
    await store.holdSearches();
    await idea.getByRole('button', { name: 'Check board game' }).click();
    await screen.getByRole('tab', { name: 'Pakistan', exact: true }).click();
    await store.releaseSearches();
    await expect.poll(async () => (await keywordSearches(store)).length).toBe(1);
    await page.waitForTimeout(500);
    // Pakistan has not been checked: no rank, and the button to check it.
    await expect(idea.getByRole('button', { name: 'Check board game' })).toBeVisible();
    await expect(idea).not.toContainText('Not found');
    await idea.getByRole('button', { name: 'Check board game' }).click();
    await expect(idea).toContainText('Rank 2');
    // The United States keeps its own answer.
    await screen.getByRole('tab', { name: 'United States', exact: true }).click();
    await expect(idea).toContainText('Not found');
    expect((await keywordSearches(store)).map((url) => url.searchParams.get('country'))).toEqual(['us', 'pk']);
  });

  test('the rank chart draws a found check between two misses as a dot, and says a day before a follow was not checked', async ({ app, page }) => {
    // Five checks of "ludo": rank 10, a miss, 8, a miss, 6. Ludo King was
    // followed today, so only today's check has a rank for it.
    const at = Date.now();
    const ranks = [10, null, 8, null, 6];
    await putGrowthRows(page, {
      meta: [UNOWNED_RIVALS, { key: 'keywords:list:', value: { owner: '', keywords: [{ term: 'ludo', addedAt: 1, source: 'typed' }], countries: ['US'], checkedAt: at } }],
      keywordDays: ranks.map((value, index) => {
        const date = dayString(index - 4);
        return { key: `${YOUR_ID}|US|ludo|${date}`, appId: String(YOUR_ID), term: 'ludo', country: 'US', date, rank: value, total: 180, rivals: index === 4 ? { [String(KING_ID)]: 3 } : {}, at };
      }),
    });
    await app.startBlankProject();
    const view = await openGrowth(page);
    await section(view, 'Keywords').click();
    const detail = keywords(page).getByTestId('growth-keyword-detail');
    await expect(detail).toContainText('"ludo"');

    // Each found check stands alone between misses, so each is a dot.
    await expect(detail.locator('circle[data-rank-dot="you"]')).toHaveCount(3);
    await expect(detail.locator(`circle[data-rank-dot="${KING_ID}"]`)).toHaveCount(1);

    // The first check is a tenth of the way across: five days, half a day of room each side.
    const plot = await detail.locator('.recharts-cartesian-grid').boundingBox();
    if (!plot) throw new Error('The chart has no plot area');
    const tip = detail.locator('.recharts-tooltip-wrapper');
    await page.mouse.move(plot.x + plot.width * 0.1, plot.y + plot.height / 2);
    await expect(tip).toContainText('Ludo King');
    await expect(tip).toContainText('Not checked');
    await expect(tip).not.toContainText('Not found');
    // The second check missed the app; Ludo King was still not checked then.
    await page.mouse.move(plot.x + plot.width * 0.3, plot.y + plot.height / 2);
    await expect(tip).toContainText('Not found');
    await expect(tip).toContainText('Not checked');
  });

  test.describe('on a connected account', () => {
    test.skip(({ isDesktop }) => !isDesktop, 'App Store Connect is reached through the desktop shell only');

    const LISTING = {
      appId: String(YOUR_ID),
      versionId: 'v-1-5',
      versionString: '1.5',
      state: 'PREPARE_FOR_SUBMISSION',
      platform: 'IOS',
      editable: true,
      appInfoEditable: true,
      primaryLocale: 'en-US',
      fetchedAt: Date.now(),
      locales: [
        {
          locale: 'en-US',
          name: 'Ludo Wala: 3D & Action',
          subtitle: 'Dice board game',
          keywords: 'ludo king,offline,multiplayer',
          promotionalText: '',
          description: 'Play ludo with friends.',
          whatsNew: '',
        },
      ],
    };

    /** A rank row as keywordWatch.ts writes it. */
    const rank = (term: string, date: string, value: number | null) => ({
      key: `${YOUR_ID}|US|${term}|${date}`,
      appId: String(YOUR_ID),
      term,
      country: 'US',
      date,
      rank: value,
      total: 180,
      rivals: {},
      at: Date.now(),
    });

    /**
     * An App Store Connect key whose account has the user's app, synced a
     * moment ago, with the store page's keywords field `keywords`. By default
     * two keywords are tracked in the United States with today's ranks in, so
     * nothing is searched: "offline" has not been found in nine checks.
     */
    async function connect(
      page: Page,
      isDesktop: boolean,
      options: { keywords?: string; tracked?: string[]; rows?: unknown[] } = {}
    ): Promise<FakeAppStore> {
      const appsRule = {
        match: '^GET https://api\\.appstoreconnect\\.apple\\.com/v1/apps\\?',
        body: JSON.stringify({ data: [{ type: 'apps', id: String(YOUR_ID), attributes: { name: 'Ludo Wala: 3D & Action', bundleId: 'com.dotnetdreamer.ludowala', sku: 'LUDO', primaryLocale: 'en-US' } }] }),
      };
      const store = new FakeAppStore(page, isDesktop, [appsRule]);
      await store.install();
      await page.evaluate(
        ({ key, appId }) => {
          localStorage.setItem(
            'open-screenshot-generator.store-credentials',
            JSON.stringify({ appstore: { issuerId: '69a6de70-0000-47e3-e053-5b8c7c11a4d1', keyId: 'ABCD123456', privateKey: key } })
          );
          localStorage.setItem('open-screenshot-generator.growth', JSON.stringify({ appId }));
        },
        { key: TEST_KEY, appId: String(YOUR_ID) }
      );
      const tracked = options.tracked ?? ['ludo online', 'offline'];
      await putGrowthRows(page, {
        listings: [options.keywords === undefined ? LISTING : { ...LISTING, locales: [{ ...LISTING.locales[0], keywords: options.keywords }] }],
        meta: [
          { key: `sync:last:${YOUR_ID}`, value: Date.now() },
          {
            key: `keywords:list:${YOUR_ID}`,
            value: {
              owner: String(YOUR_ID),
              keywords: tracked.map((term, index) => ({ term, addedAt: index + 1, source: 'typed' })),
              countries: ['US'],
              checkedAt: Date.now(),
            },
          },
        ],
        keywordDays: options.rows ?? [rank('ludo online', dayString(), 2), ...Array.from({ length: 9 }, (_, index) => rank('offline', dayString(-index), null))],
      });
      return store;
    }

    test('the Store page shows each keyword\'s rank, and the words a tracked keyword lacks go to the changes from either screen', async ({ app, page, isDesktop }) => {
      const store = await connect(page, isDesktop);
      await app.goto();
      await store.install();
      await app.startBlankProject();
      const view = await openGrowth(page);
      await section(view, 'Store page').click();

      // Under the keywords: the rank of each tracked keyword in the United States.
      const ranks = view.getByTestId('growth-listing-keyword-ranks');
      await expect(ranks).toContainText('Rank in United States:');
      await expect(ranks).toContainText('offlinenot found');
      await expect(ranks.getByTitle('Not tracked on Keywords')).toHaveText(['ludo king', 'multiplayer']);
      await expect(ranks.getByRole('button', { name: 'Track the other 2' })).toBeVisible();

      // The checks: a tracked keyword the page lacks, and a keyword search has not found the app for.
      const missing = view.getByRole('listitem').filter({ hasText: "1 keyword you track isn't on your store page" });
      await expect(missing).toContainText('"ludo online"');
      const unfound = view.getByRole('listitem').filter({ hasText: "1 of your keywords isn't found in search" });
      await expect(unfound).toContainText('Search in United States didn\'t find your app for "offline" in any of Growth\'s last 7 checks.');
      await missing.getByRole('button', { name: 'Fix', exact: true }).click();
      const change = view.getByRole('listitem').filter({ hasText: 'English, keywords' });
      await expect(change).toContainText('Added "online" from Keywords');
      await expect(change).toContainText('ludo king,offline,multiplayer,online');
      // The waiting change has the word, so the check is gone.
      await expect(missing).toHaveCount(0);

      // From the check to Keywords, where the waiting change counts too.
      await unfound.getByRole('button', { name: 'Find other keywords' }).click();
      await expect(section(view, 'Keywords')).toHaveAttribute('aria-current', 'page');
      const screen = keywords(page);
      await screen.locator('tr[data-keyword="ludo online"]').getByRole('button', { name: 'ludo online', exact: true }).click();
      const pageBlock = screen.getByTestId('growth-keyword-store-page');
      await expect(pageBlock).toContainText('Your waiting changes on Store page add this keyword.');

      // With the change discarded, Keywords adds the word itself.
      await section(view, 'Store page').click();
      await view.getByRole('button', { name: 'Discard all' }).click();
      await section(view, 'Keywords').click();
      await screen.locator('tr[data-keyword="ludo online"]').getByRole('button', { name: 'ludo online', exact: true }).click();
      await expect(pageBlock).toContainText('"online" isn\'t in your name, subtitle or keywords');
      await pageBlock.getByRole('button', { name: 'Add to keywords' }).click();
      await expect(pageBlock).toContainText('Added "online" to your changes. Apply the changes on Store page.');
      await pageBlock.getByRole('button', { name: 'Open Store page' }).click();
      await expect(section(view, 'Store page')).toHaveAttribute('aria-current', 'page');
      await expect(view.getByRole('listitem').filter({ hasText: 'English, keywords' })).toContainText('ludo king,offline,multiplayer,online');

      // Nothing was searched: today's ranks were in already.
      expect(await keywordSearches(store)).toEqual([]);
    });
    test('Add every fix cleans up the keywords first, then adds the words a tracked keyword lacks', async ({ app, page, isDesktop }) => {
      // "ludo" is in the name already, "offline" is in twice, and there is a space after a comma.
      const store = await connect(page, isDesktop, { keywords: 'ludo, offline,offline', tracked: ['ludo online'], rows: [rank('ludo online', dayString(), 2)] });
      await app.goto();
      await store.install();
      await app.startBlankProject();
      const view = await openGrowth(page);
      await section(view, 'Store page').click();
      await expect(view.getByRole('listitem').filter({ hasText: "1 keyword you track isn't on your store page" })).toBeVisible();
      await expect(view.getByRole('listitem').filter({ hasText: 'twice in the keywords' })).toBeVisible();
      await view.getByRole('button', { name: 'Add every fix' }).click();
      const change = view.getByRole('listitem').filter({ hasText: 'English, keywords' });
      // The last line of a change is the text it goes out with.
      await expect(change.locator('p').last()).toHaveText('offline,online');
      expect(await keywordSearches(store)).toEqual([]);
    });
    test('the agents read the keyword ranks through the store tools, and other clients are refused', async ({ app, page, isDesktop, tauri }) => {
      const store = await connect(page, isDesktop);
      await app.goto();
      await store.install();
      await app.startBlankProject();
      // Growth keeps the account's apps once it has listed them, which is how the tools find the app.
      const view = await openGrowth(page);
      await expect(view.getByRole('combobox', { name: 'App' })).toContainText('Ludo Wala: 3D & Action');

      const all = await mcpCall(tauri, 'list_store_keywords', {}, true);
      expect(all.isError, all.text).toBe(false);
      const ranks = JSON.parse(all.text);
      expect(ranks.app.id).toBe(String(YOUR_ID));
      expect(ranks.tracked).toBe(2);
      expect(ranks.source).toMatch(/not the same/);
      const [online, offline] = ranks.keywords;
      expect(online.keyword).toBe('ludo online');
      expect(online.countries.US.rank).toBe(2);
      expect(online.countries.US.onStorePage).toEqual({ language: 'English', fields: ['name', 'keywords'], missingWords: ['online'] });
      expect(offline.countries.US.rank).toBeNull();
      expect(offline.countries.US.missesInARow).toBe(9);
      expect(offline.countries.US.changes.day).toEqual({ since: dayString(-1), from: null, to: null });

      const one = JSON.parse((await mcpCall(tauri, 'list_store_keywords', { keyword: 'Offline', country: 'United States' }, true)).text);
      expect(one.keywords).toHaveLength(1);
      expect(one.keywords[0].countries.US.checks).toHaveLength(9);
      const unknown = await mcpCall(tauri, 'list_store_keywords', { keyword: 'chess' }, true);
      expect(unknown.isError).toBe(true);
      expect(unknown.text).toContain('"chess" is not tracked');

      const overview = JSON.parse((await mcpCall(tauri, 'get_store_overview', {}, true)).text);
      expect(overview.keywords.tracked).toBe(2);
      expect(overview.keywords.countries[0]).toMatchObject({ code: 'US', found: 1, notFound: 1, best: [{ keyword: 'ludo online', rank: 2 }] });

      // The numbers include sales, and keyword ranks are refused alongside them.
      const refused = await mcpCall(tauri, 'list_store_keywords', {}, false);
      expect(refused.isError).toBe(true);
      expect(refused.text).toContain("shared only with the app's own Claude Code and Codex agents");
      expect(await keywordSearches(store)).toEqual([]);
    });
  });
});
