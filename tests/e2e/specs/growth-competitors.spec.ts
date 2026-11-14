import { test, expect, type Page } from '../fixtures/test';
import { FakeAppStore, playListing, playShot, shotUrl, storeRow, type PlayListing, type StoreRow } from '../helpers/appStore';
import { TEST_KEY, backToEditor, growthMeta, openGrowth, putGrowthRows, section, viewButton, GROWTH_BUTTON } from '../helpers/growth';

// Growth's Competitors: App Store apps the user follows, read with Apple's
// public lookup, which needs no key, so this section works in the web build
// and on a desktop with no store key, where every other section is empty.
// Apple is answered by FakeAppStore: the page's fetch in the web build, the
// Tauri HTTP plugin on the desktop. Lookups are spaced about 3 seconds apart
// in the app, as Apple asks, so these lists check two or three countries.
// Google Play apps are followed in the desktop app only, read from their
// store pages, which FakeAppStore serves to the Tauri harness as well.

const YOUR_ID = 6797975644;
const KING_ID = 993090598;

const you = (overrides: Partial<StoreRow> = {}) =>
  storeRow({
    trackId: YOUR_ID,
    trackName: 'Ludo Wala: 3D & Action',
    artistName: 'Idrees Khan',
    version: '1.4.66',
    currentVersionReleaseDate: '2026-10-21T01:02:14Z',
    averageUserRating: 5,
    userRatingCount: 1,
    screenshotUrls: [1, 2, 3, 4].map((n) => shotUrl(`you-${n}`)),
    ...overrides,
  });

const KING_SHOTS = [1, 2, 3, 4, 5].map((n) => shotUrl(`king-${n}`));
const KING_IPAD = [shotUrl('king-ipad-1', '576x768bb.png')];

const king = (overrides: Partial<StoreRow> = {}) =>
  storeRow({
    trackId: KING_ID,
    trackName: 'Ludo King',
    artistName: 'Gametion',
    version: '10.7.424',
    currentVersionReleaseDate: '2026-11-04T04:31:17Z',
    averageUserRating: 3.73099,
    userRatingCount: 19081,
    screenshotUrls: KING_SHOTS,
    ipadScreenshotUrls: KING_IPAD,
    ...overrides,
  });

/** The Competitors screen, once Growth shows it. */
function competitors(page: Page) {
  return page.getByTestId('growth-competitors');
}

/** Open a template from the App Screenshots tab of the start dialog. */
async function openTemplate(app: import('../helpers/editor').Editor, name: string) {
  await app.startDialog.getByRole('tab', { name: /App Screenshots/ }).click();
  await app.startDialog.getByAltText(name, { exact: true }).click();
  await expect(app.startDialog).toBeHidden({ timeout: 30_000 });
  await expect(app.artboards.first()).toBeVisible({ timeout: 30_000 });
}

/** Every image in `scope` has loaded with real pixels. */
async function expectImagesLoaded(scope: ReturnType<Page['getByTestId']>, count: number) {
  const images = scope.locator('img');
  await expect(images).toHaveCount(count);
  await expect
    .poll(() => images.evaluateAll((nodes) => nodes.every((node) => (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0)))
    .toBe(true);
}

/** A list with no Growth app (the web build, a desktop with no key), stored as the app keeps it. */
function unownedList(countries: string[], checkedAt: number) {
  return {
    key: 'rivals:list:',
    value: {
      owner: '',
      rivals: [{ id: String(KING_ID), name: 'Ludo King', developer: 'Gametion', iconUrl: null, addedAt: 1 }],
      countries,
      yourApp: { id: String(YOUR_ID), name: 'Ludo Wala: 3D & Action', developer: 'Idrees Khan', iconUrl: null, addedAt: 1 },
      checkedAt,
    },
  };
}

test.describe('growth competitors', () => {
  test('with no key Growth opens on Competitors, and a followed app shows its screenshots, rating, version and price in each country', async ({ app, page, isDesktop }) => {
    const store = new FakeAppStore(page, isDesktop);
    await store.install();
    await store.sell('us', [you(), king()]);
    await store.sell('de', [you({ formattedPrice: 'Gratis', currency: 'EUR' }), king({ averageUserRating: 3.23373, userRatingCount: 3320, formattedPrice: 'Gratis', currency: 'EUR' })]);
    // Japan does not sell the user's app, and Ludo King has a set of its own there.
    await store.sell('jp', [king({ formattedPrice: '無料', currency: 'JPY', screenshotUrls: [shotUrl('king-jp-1'), shotUrl('king-jp-2')] })]);
    await store.searchFinds([king(), you()]);
    await app.startBlankProject();

    const view = await openGrowth(page);
    await expect(section(view, 'Competitors')).toHaveAttribute('aria-current', 'page');
    // Nothing on this screen waits for a key, so the reason the others give is not shown.
    await expect(view.getByTestId('growth-no-app')).toHaveCount(0);
    const screen = competitors(page);
    await expect(screen.getByText('No competitors yet', { exact: true })).toBeVisible();
    await expect(screen.getByRole('button', { name: 'Check now' })).toBeDisabled();

    // Three countries keep the test short: each one is a look at the App Store.
    const countryList = screen.getByTestId('growth-competitor-country-list');
    await expect(countryList.getByRole('listitem')).toHaveCount(8);
    for (const name of ['United Kingdom', 'France', 'Japan', 'Brazil', 'India', 'Canada']) {
      await countryList.getByRole('button', { name: `Stop checking ${name}` }).click();
    }
    await countryList.getByRole('combobox', { name: 'Add a country' }).click();
    await page.getByRole('option', { name: 'Japan', exact: true }).click();
    await expect(countryList.getByRole('listitem')).toHaveText(['United States', 'Germany', 'Japan']);

    // The user's own app, by its App Store link.
    const yours = screen.getByTestId('growth-your-app');
    await yours.getByRole('textbox', { name: 'Find your app' }).fill(`https://apps.apple.com/us/app/ludo-wala/id${YOUR_ID}`);
    await yours.getByRole('button', { name: 'This is my app Ludo Wala: 3D & Action' }).click();
    await expect(yours.getByText('Ludo Wala: 3D & Action', { exact: true })).toBeVisible();

    // Follow by name. The own app is in the results too, and says so.
    await screen.getByRole('textbox', { name: 'Find an app to follow' }).fill('ludo');
    const results = screen.getByRole('list', { name: 'Apps found' });
    await expect(results.getByRole('listitem').filter({ hasText: 'Ludo Wala' })).toContainText('Your app');
    await results.getByRole('button', { name: 'Follow Ludo King' }).click();

    // The first check looks every app up in every country, and says when it was.
    await expect(screen.getByTestId('growth-competitors-checked')).toContainText('Checked just now', { timeout: 30_000 });
    const lookups = (await store.requests()).filter((url) => url.pathname === '/lookup');
    const checked = lookups.filter((url) => (url.searchParams.get('id') ?? '').split(',').length === 2);
    expect(checked.map((url) => url.searchParams.get('country')).sort()).toEqual(['de', 'jp', 'us']);
    for (const url of checked) {
      expect(url.searchParams.get('id')?.split(',').sort()).toEqual([String(KING_ID), String(YOUR_ID)].sort());
      expect(url.searchParams.get('entity')).toBe('software');
    }

    // Side by side, as App Store search shows them: the first three screenshots.
    const compare = screen.getByTestId('growth-competitor-compare');
    await expect(compare.getByRole('heading', { name: 'Screenshots in United States' })).toBeVisible();
    const rows = compare.getByTestId('growth-competitor-row');
    await expect(rows).toHaveCount(2);
    const yourRow = rows.filter({ hasText: 'You' }).first();
    await expect(yourRow).toHaveAttribute('data-app-name', 'Ludo Wala: 3D & Action');
    const kingRow = rows.filter({ hasText: 'Ludo King' });
    await expect(kingRow).toContainText('19.1K');
    await expect(kingRow).toContainText('Version 10.7.424, Nov 4');
    await expect(kingRow).toContainText('Free');
    await expect(kingRow.getByLabel('3.7 of 5 stars')).toBeVisible();
    await expectImagesLoaded(kingRow, 4); // the icon and three screenshots
    await compare.getByRole('button', { name: 'All screenshots' }).click();
    await expectImagesLoaded(kingRow, 1 + KING_SHOTS.length);
    // Still every screenshot, as the toggle was left.

    // In each country: the rating, the price and the screenshots.
    const table = screen.getByTestId('growth-competitor-countries');
    const germany = table.getByRole('row', { name: /^Germany/ });
    await expect(germany).toContainText('5.0 (1)');
    await expect(germany).toContainText('3.2 (3,320)');
    await expect(table.getByRole('row', { name: /^Japan/ })).toContainText('Not sold');
    await table.getByRole('button', { name: 'Price', exact: true }).click();
    await expect(germany).toContainText('Gratis');
    await table.getByRole('button', { name: 'iPhone screenshots', exact: true }).click();
    await expect(table.getByRole('row', { name: /^Japan/ })).toContainText('Own set');
    await expect(table.getByRole('row', { name: /^Germany/ })).not.toContainText('Own set');

    // A country picked in the table is the one shown side by side.
    await table.getByRole('button', { name: 'Japan', exact: true }).click();
    await expect(compare.getByRole('heading', { name: 'Screenshots in Japan' })).toBeVisible();
    await expect(yourRow).toContainText('Not on the App Store in Japan');
    await expectImagesLoaded(kingRow, 1 + 2);

    // The list is kept, and the database holds what Apple answered.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await app.waitForBoot();
    await store.install();
    await openGrowth(page);
    await expect(competitors(page).getByTestId('growth-competitor-row').filter({ hasText: 'Ludo King' })).toBeVisible();
    const kept = await growthMeta<{ countries: Record<string, { version: string } | null> }>(page, `rivals:app:${KING_ID}`);
    expect(Object.keys(kept?.countries ?? {}).sort()).toEqual(['DE', 'JP', 'US']);

    // Stop following: the app goes, and so does what Growth kept about it.
    await competitors(page).getByRole('button', { name: 'Stop following Ludo King' }).click();
    await expect(competitors(page).getByText('No competitors yet', { exact: true })).toBeVisible();
    await expect.poll(() => growthMeta(page, `rivals:app:${KING_ID}`)).toBeUndefined();
  });

  test('new screenshots found while the editor is in front are announced, and Compare shows them before and after, next to yours', async ({ app, page, isDesktop }) => {
    const store = new FakeAppStore(page, isDesktop);
    await store.install();
    await app.startBlankProject();
    const old = [shotUrl('king-1'), shotUrl('king-2'), shotUrl('king-3')];
    const was = (territory: string) => ({
      territory,
      name: 'Ludo King',
      developer: 'Gametion',
      genre: 'Games',
      version: '10.7.424',
      releasedAt: '2026-11-04T04:31:17Z',
      releaseNotes: '',
      rating: 3.7,
      ratingCount: 19081,
      price: 0,
      priceLabel: 'Free',
      currency: 'USD',
      iconUrl: shotUrl(`icon-${KING_ID}`, '512x512bb.jpg'),
      screenshots: old,
      ipadScreenshots: KING_IPAD,
      storeUrl: null,
      seenAt: 1,
    });
    // Followed before, and last checked 13 hours ago: due a check.
    await putGrowthRows(page, {
      meta: [
        unownedList(['US', 'DE'], Date.now() - 13 * 3_600_000),
        { key: `rivals:app:${KING_ID}`, value: { id: String(KING_ID), countries: { US: was('US'), DE: was('DE') }, checkedAt: 1 } },
      ],
    });
    // A new version, with one screenshot replaced, everywhere.
    const now = [shotUrl('king-1'), shotUrl('king-new'), shotUrl('king-3')];
    const released = { version: '10.8.0', currentVersionReleaseDate: '2026-11-12T08:00:00Z', releaseNotes: 'Winter board', screenshotUrls: now };
    await store.sell('us', [you(), king(released)]);
    await store.sell('de', [you(), king(released)]);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await app.waitForBoot();
    await store.install();
    await store.holdLookups();

    // Opening the screen checks a list that is due; the editor comes back in front while Apple answers.
    await openGrowth(page);
    await expect(competitors(page).getByRole('status')).toContainText('Checking');
    await backToEditor(page);
    await store.releaseLookups();

    // A toast is drawn twice, once for screen readers; the first is the one on screen.
    const toasts = page.getByRole('region', { name: /Notifications/ });
    await expect(toasts.getByText('Ludo King changed its iPhone screenshots').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('growth-badge')).toHaveText('1');

    await toasts.getByRole('button', { name: 'Compare', exact: true }).click();
    const screen = competitors(page);
    await expect(section(page.getByTestId('growth-view'), 'Competitors')).toHaveAttribute('aria-current', 'page');
    const card = screen.locator('[data-rival-change]').filter({ hasText: 'Ludo King changed its iPhone screenshots' });
    await expect(card.getByTestId('growth-change-new')).toBeVisible();
    await expect(card).toContainText('1 new screenshot, 1 taken out');
    await expect(card).toContainText('In every country checked');
    // Opened from the alert, the change shows its screenshots before and after.
    await expect(card.getByRole('img', { name: /before, screenshot/ })).toHaveCount(3);
    await expect(card.getByRole('img', { name: /now, screenshot/ })).toHaveCount(3);
    await expect(screen.locator('[data-rival-change]').filter({ hasText: 'Ludo King released version 10.8.0' })).toBeVisible();
    // Seen now: the activity bar has nothing waiting.
    await expect(page.getByTestId('growth-badge')).toHaveCount(0);

    await card.getByRole('button', { name: 'Compare with yours' }).click();
    const kingRow = screen.getByTestId('growth-competitor-row').filter({ hasText: 'Ludo King' });
    await expect(kingRow).toContainText('Version 10.8.0');
    await expect(kingRow.getByRole('img', { name: 'Ludo King, screenshot 2' })).toHaveAttribute('src', /king-new\.png\/600x600bb\.webp$/);
    await expect(screen.getByTestId('growth-competitor-row').filter({ hasText: 'You' })).toBeVisible();

    // Seen stays seen.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await app.waitForBoot();
    await viewButton(page, GROWTH_BUTTON).click();
    await expect(competitors(page).locator('[data-rival-change]').first()).toBeVisible();
    await expect(competitors(page).getByTestId('growth-change-new')).toHaveCount(0);
  });

  test('in the web build a Google Play link says where Google Play apps can be followed', async ({ app, page, isDesktop }) => {
    test.skip(isDesktop, 'the desktop app reads Google Play pages');
    const store = new FakeAppStore(page, isDesktop);
    await store.install();
    await app.startBlankProject();
    await openGrowth(page);
    const screen = competitors(page);
    await screen.getByRole('textbox', { name: 'Find an app to follow' }).fill('https://play.google.com/store/apps/details?id=com.ludo.king');
    await expect(
      screen.getByText('Google Play apps can be followed in the desktop app. Here, paste an App Store link or type the name of the app', { exact: true })
    ).toBeVisible();
    await expect(screen.getByRole('list', { name: 'Apps found' })).toHaveCount(0);
    expect(await store.requests(), 'nothing is asked of Apple for a Google Play link').toHaveLength(0);
  });

  test('in the desktop app a Google Play app is followed by its link, shows its page in each country, and its new screenshots are announced', async ({ app, page, isDesktop }) => {
    test.skip(!isDesktop, 'Google Play pages can be read by the desktop app only');
    const store = new FakeAppStore(page, isDesktop);
    await store.install();
    // The first screenshot is wide, like Ludo King's on Google Play.
    const shots = [playShot('king-1', 1920, 1080), playShot('king-2'), playShot('king-3')];
    const kingPlay = (overrides: Partial<PlayListing> = {}) =>
      playListing({ packageName: 'com.ludo.king', name: 'Ludo King®', developer: 'Gametion', rating: 4.132999, ratingCount: 12345, screenshots: shots, ...overrides });
    await store.showOnPlay('US', [kingPlay()]);
    await store.showOnPlay('DE', [kingPlay({ rating: 3.73, currency: 'EUR' })]);
    await app.startBlankProject();

    await openGrowth(page);
    const screen = competitors(page);
    await expect(screen.getByRole('textbox', { name: 'Find an app to follow' })).toHaveAttribute('placeholder', 'App name or store link');
    // Two countries keep the test short: each one is a page per Google Play app.
    const countryList = screen.getByTestId('growth-competitor-country-list');
    for (const name of ['United Kingdom', 'France', 'Japan', 'Brazil', 'India', 'Canada']) {
      await countryList.getByRole('button', { name: `Stop checking ${name}` }).click();
    }
    await expect(countryList.getByRole('listitem')).toHaveText(['United States', 'Germany']);

    // Followed by its link: Growth does not search Google Play.
    await screen.getByRole('textbox', { name: 'Find an app to follow' }).fill('https://play.google.com/store/apps/details?id=com.ludo.king&hl=en');
    const results = screen.getByRole('list', { name: 'Apps found' });
    await expect(results.getByRole('listitem')).toHaveCount(1);
    await expect(results).toContainText('Gametion');
    await results.getByRole('button', { name: 'Follow Ludo King®', exact: true }).click();
    await expect(screen.getByTestId('growth-competitors-checked')).toContainText('Checked just now', { timeout: 30_000 });

    // Each country's page, in the language of that country.
    const asked = (await store.playRequests()).map((url) => `${url.searchParams.get('id')} ${url.searchParams.get('gl')} ${url.searchParams.get('hl')}`);
    expect(asked).toEqual(expect.arrayContaining(['com.ludo.king US en-US', 'com.ludo.king DE de-DE']));
    expect(await store.requests(), 'a list of Google Play apps asks nothing of Apple').toHaveLength(0);

    // Side by side: the day of the last update stands in for a version, and a wide first screenshot shows alone.
    const compare = screen.getByTestId('growth-competitor-compare');
    const kingRow = compare.getByTestId('growth-competitor-row').filter({ hasText: 'Ludo King®' });
    await expect(kingRow).toContainText('Updated Nov 6');
    await expect(kingRow).toContainText('Free');
    await expect(kingRow).toContainText('12.3K');
    await expect(kingRow.getByLabel('4.1 of 5 stars')).toBeVisible();
    await expectImagesLoaded(kingRow, 2); // the icon and the wide screenshot
    await compare.getByRole('button', { name: 'All screenshots' }).click();
    // The page lists the set twice, for the phone and the tablet; it shows once.
    await expectImagesLoaded(kingRow, 1 + shots.length);
    const devices = screen.getByRole('group', { name: 'Device' });
    await expect(devices.getByRole('button')).toHaveText(['Phone', 'Tablet']);
    await devices.getByRole('button', { name: 'Tablet' }).click();
    await expect(kingRow).toContainText('Google Play shows the screenshots of every device together, under Phone');
    await devices.getByRole('button', { name: 'Phone' }).click();

    // In each country: the rating that country gives, and the update day.
    const table = screen.getByTestId('growth-competitor-countries');
    await expect(table.getByRole('row', { name: /^United States/ })).toContainText('4.1 (12.3K)');
    await expect(table.getByRole('row', { name: /^Germany/ })).toContainText('3.7 (12.3K)');
    await table.getByRole('button', { name: 'Version', exact: true }).click();
    await expect(table.getByRole('row', { name: /^Germany/ })).toContainText('Updated');

    // An update with one screenshot replaced, in both countries. The editor comes back in front while Google answers.
    const updated = { screenshots: [shots[0], playShot('king-new'), shots[2]], updated: Date.parse('2026-11-13T08:00:00Z') / 1000, whatsNew: 'Winter board' };
    await store.showOnPlay('US', [kingPlay(updated)]);
    await store.showOnPlay('DE', [kingPlay({ rating: 3.73, currency: 'EUR', ...updated })]);
    await store.holdLookups();
    await screen.getByRole('button', { name: 'Check now' }).click();
    await expect(screen.getByRole('status')).toContainText('Checking');
    await backToEditor(page);
    await store.releaseLookups();

    const toasts = page.getByRole('region', { name: /Notifications/ });
    await expect(toasts.getByText('Ludo King® changed its Google Play screenshots').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('growth-badge')).toHaveText('1');
    // Growth's button leads to the change as well as the toast does (the App Store test takes the toast's Compare).
    // The card was drawn while the editor was in front, and opens on its screenshots once it counts as new.
    await viewButton(page, GROWTH_BUTTON).click();
    await expect(page.getByTestId('growth-badge')).toHaveCount(0);
    const card = competitors(page).locator('[data-rival-change]').filter({ hasText: 'Ludo King® changed its Google Play screenshots' });
    await expect(card.getByTestId('growth-change-new')).toBeVisible();
    await expect(card).toContainText('1 new screenshot, 1 taken out');
    await expect(card).toContainText('In every country checked');
    await expect(card.getByRole('img', { name: /before, screenshot/ })).toHaveCount(3);
    await expect(card.getByRole('img', { name: /now, screenshot/ })).toHaveCount(3);
    const update = competitors(page).locator('[data-rival-change]').filter({ hasText: 'Ludo King® released an update' });
    await update.getByText('What is new in the update').click();
    await expect(update).toContainText('Winter board');
    // What the page showed is kept under the app's Google Play id.
    const kept = await growthMeta<{ countries: Record<string, { screenshots: string[] } | null> }>(page, 'rivals:app:play:com.ludo.king');
    expect(kept?.countries.US?.screenshots).toEqual([shots[0], playShot('king-new'), shots[2]].map((shot) => `${shot.url}=w${shot.width}-h${shot.height}`));
  });

  test('when Google Play fails in one country while the App Store answers, the screen says so and the Google Play app is tried again an hour later', async ({ app, page, isDesktop }) => {
    test.skip(!isDesktop, 'Google Play pages can be read by the desktop app only');
    // The background pass runs every half hour; the clock skips ahead.
    await page.clock.install();
    await app.goto();
    const store = new FakeAppStore(page, isDesktop);
    await store.install();
    const kingPlay = playListing({ packageName: 'com.ludo.king', name: 'Ludo King®', developer: 'Gametion', version: '3.9.0', screenshots: [playShot('king-1'), playShot('king-2')] });
    await store.sell('US', [king()]);
    await store.sell('DE', [king()]);
    await store.showOnPlay('US', [kingPlay]);
    await store.showOnPlay('DE', [kingPlay]);
    await store.refuseOnPlay('DE', 'com.ludo.king');
    // Both apps followed, never checked: opening Competitors checks them.
    await putGrowthRows(page, {
      meta: [
        {
          key: 'rivals:list:',
          value: {
            owner: '',
            rivals: [
              { id: String(KING_ID), name: 'Ludo King', developer: 'Gametion', iconUrl: null, addedAt: 1 },
              { id: 'play:com.ludo.king', name: 'Ludo King®', developer: 'Gametion', iconUrl: null, addedAt: 2 },
            ],
            countries: ['US', 'DE'],
          },
        },
      ],
    });
    await app.startBlankProject();

    await openGrowth(page);
    const screen = competitors(page);
    await expect(screen.getByTestId('growth-competitors-checked')).toContainText('Checked just now', { timeout: 30_000 });
    await expect(screen.getByTestId('growth-competitors-trouble')).toHaveText(['Google Play did not answer in 1 country in the last check. Growth tries again in an hour']);
    // A Google Play page that shows a version has it read.
    const playRow = screen.getByTestId('growth-competitor-compare').getByTestId('growth-competitor-row').filter({ hasText: 'Ludo King®' });
    await expect(playRow).toContainText('Version 3.9.0, Nov 6');
    type StoredList = { checkedAt?: number; trouble?: Record<string, { countries: number; unreadable: boolean }> };
    const checked = await growthMeta<StoredList>(page, 'rivals:list:');
    expect(checked?.trouble).toEqual({ playstore: expect.objectContaining({ countries: 1, unreadable: false }) });

    // Google answers again. An hour and a half on, the background pass asks Google Play again, and only Google Play.
    await store.showOnPlay('DE', [kingPlay]);
    await backToEditor(page);
    const lookups = async () => (await store.requests()).filter((url) => url.pathname === '/lookup').length;
    const appleBefore = await lookups();
    const playBefore = (await store.playRequests()).length;
    await page.clock.fastForward('01:31:00');
    await expect.poll(async () => (await growthMeta<StoredList>(page, 'rivals:list:'))?.trouble, { timeout: 60_000 }).toBeUndefined();
    const playAsked = (await store.playRequests()).slice(playBefore).map((url) => url.searchParams.get('gl'));
    expect(playAsked.sort()).toEqual(['DE', 'US']);
    expect(await lookups(), 'the App Store answered everywhere, so it is not asked again').toBe(appleBefore);
    expect((await growthMeta<StoredList>(page, 'rivals:list:'))?.checkedAt, 'the next whole check comes when it would have').toBe(checked?.checkedAt);
    await openGrowth(page);
    await expect(competitors(page).getByTestId('growth-competitors-checked')).toBeVisible();
    await expect(competitors(page).getByTestId('growth-competitors-trouble')).toHaveCount(0);
  });

  test('a new screenshot change older than the newest six changes is listed when Competitors opens, so it is not counted as seen unseen', async ({ app, page, isDesktop }) => {
    const store = new FakeAppStore(page, isDesktop);
    const day = 86_400_000;
    const now = Date.now();
    // Six newer versions the user has seen, and new screenshots found before them, not seen yet.
    const versions = [1, 2, 3, 4, 5, 6].map((n) => ({
      id: `${KING_ID}:version:${n}`,
      appId: String(KING_ID),
      kind: 'version',
      foundAt: now - n * day,
      territories: ['US'],
      before: [`10.7.${n}`],
      after: [`10.7.${n + 1}`],
    }));
    const screenshots = {
      id: `${KING_ID}:screenshots:old`,
      appId: String(KING_ID),
      kind: 'screenshots',
      foundAt: now - 8 * day,
      territories: ['US'],
      before: KING_SHOTS,
      after: [shotUrl('king-new'), ...KING_SHOTS.slice(1)],
    };
    await putGrowthRows(page, {
      meta: [
        { ...unownedList(['US'], now) },
        { key: `rivals:changes:${KING_ID}`, value: [...versions, screenshots] },
        { key: 'rivals:seen', value: versions.map((change) => change.id) },
      ],
    });
    await app.goto();
    await store.install();
    await app.startBlankProject();
    await expect(page.getByTestId('growth-badge')).toHaveText('1');

    await viewButton(page, GROWTH_BUTTON).click();
    const card = competitors(page).locator('[data-rival-change]').filter({ hasText: 'Ludo King changed its iPhone screenshots' });
    await expect(card.getByTestId('growth-change-new')).toBeVisible();
    await expect(card.getByRole('img', { name: /now, screenshot/ })).toHaveCount(KING_SHOTS.length);
    await expect(page.getByTestId('growth-badge')).toHaveCount(0);
    await expect(competitors(page).locator('[data-rival-change]')).toHaveCount(7);
  });

  test('the open project shows in the language on screen in the editor', async ({ app, page, isDesktop }) => {
    // A language added and switched to is the heaviest editor work in this spec.
    test.setTimeout(240_000);
    const store = new FakeAppStore(page, isDesktop);
    await store.install();
    await putGrowthRows(page, { meta: [unownedList(['US'], Date.now())] });
    await openTemplate(app, 'Somnia Sleep');

    // German, with the first string typed by hand (machine translation off: it would call an outside service).
    const languageMenu = async () => {
      const collapsed = page.getByRole('button', { name: 'Language', exact: true });
      const trigger = (await collapsed.count()) ? collapsed : page.locator('button[title^="Showing "]');
      await trigger.first().click();
      await expect(page.getByRole('menu')).toBeVisible({ timeout: 10_000 });
    };
    await languageMenu();
    await page.getByRole('menuitem', { name: /Add language|Manage languages/ }).first().click();
    const languages = page.getByRole('dialog').filter({ hasText: 'Languages' });
    await languages.getByRole('textbox', { name: 'Search languages' }).fill('German');
    await languages.locator('#locale-de-DE').click();
    const seed = languages.getByLabel('Fill in machine translations to start from');
    if ((await seed.count()) && (await seed.getAttribute('aria-checked')) === 'true') await seed.click();
    await languages.getByRole('button', { name: /^(Add \d+ languages?|Save languages)$/ }).click();
    await expect(languages).toBeHidden({ timeout: 20_000 });
    await languageMenu();
    await page.getByRole('menuitem', { name: 'Translations table' }).click();
    const table = page.getByRole('dialog').filter({ hasText: 'Translations' });
    const cell = table.getByRole('textbox').first();
    await expect(cell).toBeVisible({ timeout: 15_000 });
    await cell.fill('Guten Morgen E2E');
    await cell.blur();
    await table.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(table).toBeHidden({ timeout: 20_000 });
    await languageMenu();
    await page.getByRole('menuitemcheckbox', { name: /Deutsch/ }).click();
    await expect(page.getByText('Guten Morgen E2E').first()).toBeVisible({ timeout: 20_000 });

    await openGrowth(page);
    const compare = competitors(page).getByTestId('growth-competitor-compare');
    await compare.getByRole('button', { name: 'All screenshots' }).click();
    const projectRow = compare.getByTestId('growth-competitor-project');
    await expect(projectRow).toContainText('In Deutsch (de-DE)');
    await expect(projectRow.getByText('Guten Morgen E2E').first()).toBeVisible();
  });

  test('the open project shows as many 3D phones in 3D as the store preview, and the rest flat', async ({ app, page, isDesktop }) => {
    // On 2026-11-14 the web project's Chromium stalled in the editor with this template's eight 3D phones on the canvas,
    // before Growth opened, in both runs (a menu click, then the start dialog's closing animation). WebKit opens it in seconds.
    test.skip(!isDesktop, 'Chromium stalls in the editor on eight 3D phones on this Mac; the row is the same code in both builds');
    const store = new FakeAppStore(page, isDesktop);
    await store.install();
    await putGrowthRows(page, { meta: [unownedList(['US'], Date.now())] });
    await openTemplate(app, 'Verda Eco');

    await openGrowth(page);
    const compare = competitors(page).getByTestId('growth-competitor-compare');
    const projectRow = compare.getByTestId('growth-competitor-project');
    await compare.getByRole('button', { name: 'All screenshots' }).click();
    // Two, four and two 3D phones on the first three artboards: six in 3D, then two drawn flat.
    await expect(projectRow).toContainText('Some 3D frames are drawn flat here');
    await expect(projectRow.locator('canvas')).toHaveCount(6, { timeout: 30_000 });
  });

  test.describe('on a connected account', () => {
    test.skip(({ isDesktop }) => !isDesktop, 'App Store Connect is reached through the desktop shell only');

    /** An App Store Connect key whose account has the user's app, synced a moment ago so no sync starts, with `list` in the database. */
    async function connect(page: Page, isDesktop: boolean, list: { key: string; value: unknown }): Promise<FakeAppStore> {
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
      await putGrowthRows(page, { meta: [{ key: `sync:last:${YOUR_ID}`, value: Date.now() }, list] });
      await store.sell('us', [you(), king()]);
      await store.sell('de', [you(), king()]);
      return store;
    }

    test('the competitors followed before the key take the app over, and the app is looked up with them', async ({ app, page, isDesktop }) => {
      // Followed with the app named as the user's, and due a check.
      const store = await connect(page, isDesktop, unownedList(['US', 'DE'], Date.now() - 13 * 3_600_000));
      await app.goto();
      await store.install();
      await app.startBlankProject();

      // With a key, Growth opens on the overview.
      const view = await openGrowth(page);
      await expect(section(view, 'Overview')).toHaveAttribute('aria-current', 'page');
      await section(view, 'Competitors').click();
      const screen = competitors(page);
      await expect(screen.getByTestId('growth-competitors-checked')).toContainText('Checked just now', { timeout: 30_000 });
      // Growth's own app is the user's: nothing to name, nothing to move.
      await expect(screen.getByTestId('growth-your-app')).toHaveCount(0);
      await expect(screen.getByTestId('growth-unowned-rivals')).toHaveCount(0);
      const rows = screen.getByTestId('growth-competitor-row');
      await expect(rows.filter({ hasText: 'You' })).toHaveAttribute('data-app-name', 'Ludo Wala: 3D & Action');
      await expect(rows.filter({ hasText: 'Ludo King' })).toBeVisible();
      expect(await growthMeta(page, 'rivals:list:')).toBeUndefined();
      expect((await growthMeta<{ rivals: Array<{ id: string }> }>(page, `rivals:list:${YOUR_ID}`))?.rivals.map((rival) => rival.id)).toEqual([String(KING_ID)]);
    });

    test('competitors followed before the key, with no app named, move to the app on request', async ({ app, page, isDesktop }) => {
      const unnamed = unownedList(['US', 'DE'], Date.now());
      delete (unnamed.value as { yourApp?: unknown }).yourApp;
      const store = await connect(page, isDesktop, unnamed);
      await app.goto();
      await store.install();
      await app.startBlankProject();

      const view = await openGrowth(page);
      await section(view, 'Competitors').click();
      const screen = competitors(page);
      const notice = screen.getByTestId('growth-unowned-rivals');
      await expect(notice).toContainText('You followed Ludo King before you added your key.');
      await expect(screen.getByText('No competitors yet', { exact: true })).toBeVisible();
      await notice.getByRole('button', { name: 'Follow Ludo King for Ludo Wala: 3D & Action' }).click();
      await expect(notice).toHaveCount(0);
      // Moved, and looked up for the app at once.
      await expect(screen.getByTestId('growth-competitors-checked')).toContainText('Checked just now', { timeout: 30_000 });
      await expect(screen.getByTestId('growth-competitor-row').filter({ hasText: 'Ludo King' })).toBeVisible();
      expect(await growthMeta(page, 'rivals:list:')).toBeUndefined();
    });
  });
});
