import path from 'node:path';
import { test, expect } from '../fixtures/test';
import { growthMeta, openGrowth, putGrowthRows, releaseHeldCommands, section } from '../helpers/growth';
import { STUDIO_APPS, STUDIO_RULES, connectStudioAccount } from '../helpers/today';

// Today: every app of the account on one page (GrowthToday.tsx, studio.ts).
// Without a key it is there and empty and says what to set up; with one,
// Growth opens on it. The account here has five apps (helpers/today.ts):
// three App Store apps with numbers (one of them new), a Google Play app whose
// numbers end four days earlier, and an App Store app never refreshed.
//
// Set TODAY_SHOTS to a folder to also save pictures of the screen there, in
// the light and the dark theme.

const SHOTS = process.env.TODAY_SHOTS;

async function shoot(page: import('@playwright/test').Page, name: string) {
  if (!SHOTS) return;
  await page.getByTestId('growth-today').screenshot({ path: path.join(SHOTS, `${name}.png`), animations: 'disabled' });
}

test.describe('Growth Today', () => {
  test('without a key Growth opens on Ask AI, and Today is there and empty, saying what to set up', async ({ app, page, isDesktop }) => {
    await app.startBlankProject();
    const view = await openGrowth(page);
    await expect(section(view, 'Ask AI')).toHaveAttribute('aria-current', 'page');
    await section(view, 'Today').click();

    const today = view.getByTestId('growth-today');
    await expect(today).toBeVisible();
    await expect(today.getByRole('button', { name: isDesktop ? 'Set up with Ask AI' : 'Get the desktop app' })).toBeVisible();
    await expect(today.getByTestId('growth-today-tile-downloads')).toContainText('n/a');
    await expect(today.getByTestId('growth-today-columns')).toContainText('No numbers yet');
    // Refresh all stays where it is, disabled, and says why.
    const refresh = view.locator('header').getByRole('button', { name: 'Refresh all' });
    await expect(refresh).toBeDisabled();
    await expect(refresh.locator('xpath=..')).toHaveAttribute('data-gated-reason', /.+/);
  });

  test.describe('on an account with several apps', () => {
    test.skip(({ isDesktop }) => !isDesktop, 'App Store Connect is reached through the desktop shell only');
    test.use({ tauriConfig: { http: STUDIO_RULES } });

    test.beforeEach(async ({ app, page }) => {
      await connectStudioAccount(page);
      await app.goto();
      await app.startBlankProject();
    });

    test("Growth opens on Today, which adds every app up, and each app's number is the one its Overview shows", async ({ page }) => {
      const problems: string[] = [];
      if (SHOTS) {
        await page.setViewportSize({ width: 1512, height: 2700 });
        page.on('console', (message) => {
          if (message.type() === 'error' || message.type() === 'warning') problems.push(`${message.type()}: ${message.text()}`);
        });
        page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
      }
      const view = await openGrowth(page);
      await expect(section(view, 'Today')).toHaveAttribute('aria-current', 'page');
      const today = view.getByTestId('growth-today');
      const brief = today.getByTestId('growth-today-brief');
      await expect(brief).toContainText('Your apps got');
      await expect(brief).toContainText(`In ${STUDIO_APPS.juniper.name}, the download rate is up`);

      const list = today.getByTestId('growth-today-apps');
      await expect(list.locator('li[data-app-id]')).toHaveCount(5);
      // The app nobody refreshed says so, and offers the refresh.
      const orbit = list.locator(`li[data-app-id="${STUDIO_APPS.orbit.id}"]`);
      await expect(orbit).toContainText('Not refreshed yet');
      await expect(orbit.getByRole('button', { name: 'Refresh' })).toBeVisible();

      // The total is the apps added up, and the new app sits out of the comparison.
      const rows = [STUDIO_APPS.juniper, STUDIO_APPS.fernleaf, STUDIO_APPS.tidewell, STUDIO_APPS.pebble];
      const values: number[] = [];
      for (const entry of rows) {
        const value = await list.locator(`li[data-app-id="${entry.id}"] [data-downloads]`).getAttribute('data-downloads');
        expect(value, `${entry.name} has new downloads`).toMatch(/^\d+$/);
        values.push(Number(value));
      }
      const tile = today.getByTestId('growth-today-tile-downloads');
      await expect(tile.locator('[data-value]')).toHaveAttribute('data-value', String(values.reduce((a, b) => a + b, 0)));
      await expect(tile).toContainText('Compared for 3 of 4 apps');
      // Google Play's numbers end earlier, so the dates differ and the newest columns are lighter.
      await expect(today.getByRole('button', { name: 'Why the dates differ' })).toBeVisible();
      await expect(today.getByTestId('growth-today-columns')).toContainText("some apps' numbers aren't in yet");
      // The new screenshots of the sample app are measured here too.
      await expect(today.getByTestId('growth-today-screenshots')).toContainText(STUDIO_APPS.juniper.name);
      await expect(today.getByTestId('growth-today-countries')).toContainText('United States');

      if (SHOTS) {
        await shoot(page, 'today-light');
        await page.evaluate(() => {
          localStorage.setItem('open-screenshot-generator.theme', 'dark');
          document.documentElement.classList.add('dark');
        });
        await shoot(page, 'today-dark');
        await page.evaluate(() => {
          localStorage.setItem('open-screenshot-generator.theme', 'light');
          document.documentElement.classList.remove('dark');
        });
        const { writeFileSync } = await import('node:fs');
        writeFileSync(path.join(SHOTS, 'console.txt'), problems.join('\n'));
      }

      // A row opens its app's Overview, whose New downloads tile shows the same number.
      for (const entry of [STUDIO_APPS.juniper, STUDIO_APPS.fernleaf]) {
        await section(view, 'Today').click();
        const row = view.getByTestId('growth-today-apps').locator(`li[data-app-id="${entry.id}"]`);
        const shown = (await row.locator('[data-downloads]').innerText()).trim();
        await row.getByRole('button', { name: entry.name, exact: true }).click();
        await expect(section(view, 'Overview')).toHaveAttribute('aria-current', 'page');
        await expect(view.getByRole('combobox', { name: 'App' })).toContainText(entry.name);
        await expect(view.getByRole('button', { name: /^New downloads/ })).toContainText(shown);
      }
    });

    test('a to-do of your own, due today, counts on Today and on its button until it is ticked off', async ({ app, page }) => {
      const view = await openGrowth(page);
      const todo = view.getByTestId('growth-today-todo');
      const counts = todo.getByTestId('growth-today-todo-counts');
      await expect(counts).toContainText('0Due today');
      await todo.getByRole('button', { name: 'Add a to-do' }).click();
      const form = todo.getByTestId('growth-today-add-todo');
      await form.getByRole('textbox', { name: 'What needs doing' }).fill('Send the new build to TestFlight');
      // The person's own calendar day, which is what the date box and "Due today" use.
      const day = await page.evaluate(() => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; });
      await form.getByLabel('Due on').fill(day);
      await form.getByRole('button', { name: 'Add', exact: true }).click();

      const item = todo.locator('li').filter({ hasText: 'Send the new build to TestFlight' });
      await expect(item).toContainText('Due today');
      await expect(counts).toContainText('1Due today');
      await expect(section(view, 'Today')).toContainText('1');

      // Still there after a reload, and ticked off it stops counting.
      await app.goto();
      await app.startBlankProject();
      const again = await openGrowth(page);
      const kept = again.getByTestId('growth-today-todo').locator('li').filter({ hasText: 'Send the new build to TestFlight' });
      await expect(kept).toBeVisible();
      await kept.getByRole('checkbox', { name: 'Done: Send the new build to TestFlight' }).click();
      await expect(kept.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');
      await expect(again.getByTestId('growth-today-todo-counts')).toContainText('0Due today');
      await expect(section(again, 'Today')).not.toContainText('1');
    });

    test('a to-do folded under Show all does not count as seen until the list opens', async ({ page }) => {
      // Three of the user's own come first, so more of the ones Growth worked out wait under Show all.
      const own = ['Plan the winter sale', 'Record the new preview video', 'Ask testers about the onboarding'].map((title, index) => ({
        id: `todo-e2e-${index}`,
        title,
        appId: null,
        due: null,
        createdAt: Date.now() + index,
      }));
      await putGrowthRows(page, { meta: [{ key: 'today:todos', value: own }] });
      const view = await openGrowth(page);
      const todo = view.getByTestId('growth-today-todo');
      const showAll = todo.getByRole('button', { name: /^Show all \d+/ });
      await expect(showAll).toBeVisible();
      const seen = async () => {
        const out = new Set<string>();
        for (const app of Object.values(STUDIO_APPS)) for (const id of (await growthMeta<string[]>(page, `insights:seen:${app.id}`)) ?? []) out.add(`insight:${app.id}:${id}`);
        return out;
      };
      const rowIds = () => todo.locator('li[data-todo-id]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-todo-id') ?? ''));
      // The insights on screen are marked seen.
      const visible = (await rowIds()).filter((id) => id.startsWith('insight:'));
      expect(visible.length, 'some insight is listed').toBeGreaterThan(0);
      await expect.poll(async () => { const set = await seen(); return visible.every((id) => set.has(id)); }).toBe(true);
      const before = await seen();

      await showAll.click();
      const all = await rowIds();
      // The picked app's insights all count as seen whatever the screen (GrowthWorkspace), so only the others can tell.
      const picked = STUDIO_APPS.fernleaf.id;
      const folded = all.slice(6).filter((id) => id.startsWith('insight:') && !id.startsWith(`insight:${picked}:`));
      expect(folded.length, 'an insight of another app waited under Show all').toBeGreaterThan(0);
      for (const id of folded) expect(before.has(id), `${id} was not counted as seen while folded`).toBe(false);
      await expect.poll(async () => { const set = await seen(); return folded.every((id) => set.has(id)); }).toBe(true);
    });

    test("To do lists each app's reviews waiting for a reply, and Answer opens them on that app", async ({ page }) => {
      const view = await openGrowth(page);
      const todo = view.getByTestId('growth-today-todo');
      const item = todo.locator('li').filter({ hasText: STUDIO_APPS.pebble.name }).filter({ hasText: 'Answer 1 review' });
      await expect(item).toBeVisible();
      await item.getByRole('button', { name: 'Answer' }).click();
      await expect(section(view, 'Reviews')).toHaveAttribute('aria-current', 'page');
      await expect(view.getByRole('combobox', { name: 'App' })).toContainText(STUDIO_APPS.pebble.name);
      await expect(view.getByText('Sync lost a note')).toBeVisible();
    });
  });

  test.describe('Refresh all', () => {
    test.skip(({ isDesktop }) => !isDesktop, 'App Store Connect is reached through the desktop shell only');
    // The first app's first request to App Store Connect waits, so the refresh is caught mid-way.
    test.use({
      tauriConfig: {
        http: [...STUDIO_RULES, { match: '^GET https://api\\.appstoreconnect\\.apple\\.com/v1/(?!apps\\?)', status: 404, body: '{}', hold: true }],
      },
    });

    test.beforeEach(async ({ app, page }) => {
      await connectStudioAccount(page);
      await app.goto();
      await app.startBlankProject();
    });

    test('reads one app after another, and Stop ends it before the next app starts', async ({ page }) => {
      const view = await openGrowth(page);
      const header = view.locator('header');
      await header.getByRole('button', { name: 'Refresh all' }).click();
      const status = header.getByRole('status');
      await expect(status).toContainText('1 of 5');
      // The first app in the picker's order, which is Apple's list: by name.
      const first = STUDIO_APPS.fernleaf;
      await expect(status).toContainText(`Refreshing ${first.name}`);
      await header.getByRole('button', { name: 'Stop' }).click();
      // Let the request that was waiting answer, so the stopped refresh can end.
      await page.evaluate(() => (window as unknown as { __E2E_TAURI__: { releaseHttp(): number } }).__E2E_TAURI__.releaseHttp());
      await releaseHeldCommands(page);
      await expect(header.getByRole('button', { name: 'Refresh all' })).toBeVisible({ timeout: 30_000 });
      const urls = await page.evaluate(() => (window as unknown as { __E2E_TAURI__: { httpRequests: Array<{ url: string }> } }).__E2E_TAURI__.httpRequests.map((request) => request.url));
      expect(urls.some((url) => url.includes(`/v1/apps/${first.id}`)), 'the first app was read').toBe(true);
      for (const other of [STUDIO_APPS.juniper, STUDIO_APPS.tidewell, STUDIO_APPS.orbit]) {
        expect(urls.some((url) => url.includes(`/v1/apps/${other.id}`)), `${other.name} was not read`).toBe(false);
      }
    });
  });
});
