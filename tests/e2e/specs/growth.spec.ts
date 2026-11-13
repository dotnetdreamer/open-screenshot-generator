import { test, expect, type Page } from '../fixtures/test';

// Growth, on the sample app: the web build can never reach App Store Connect
// and the desktop build has no key in a test, so both land on Juniper, the
// made-up app whose numbers are the same on every run (src/lib/growth/sample.ts).

const GROWTH_BUTTON = 'Growth: downloads, conversion, reviews and the store listing';

async function openGrowth(page: Page) {
  await page.getByTitle(GROWTH_BUTTON).click();
  const dialog = page.getByTestId('growth-dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

function section(dialog: ReturnType<Page['getByTestId']>, name: string) {
  return dialog.getByRole('navigation', { name: 'Growth sections' }).getByRole('button', { name: new RegExp(`^${name}`) });
}

test.describe('growth', () => {
  test('the toolbar opens Growth on the sample app, and the overview measures the new screenshots', async ({ app, page, isDesktop }) => {
    await app.startBlankProject();
    const dialog = await openGrowth(page);

    await expect(dialog.getByText('Sample data', { exact: true })).toBeVisible();
    await expect(
      dialog.getByText(isDesktop ? /Connect your App Store Connect key/ : /Your own app needs the desktop app/)
    ).toBeVisible();

    const impact = dialog.getByTestId('growth-impact');
    await expect(impact).toContainText('Did the new screenshots work?');
    await expect(impact).toContainText('Up');
    await expect(impact).toContainText('to version 2.4');
    await expect(impact).toContainText('14 of 14 days measured');
    // A before and after comparison names what else changed in its weeks.
    await expect(impact.getByTestId('growth-impact-others')).toBeVisible();

    for (const tile of ['Impressions', 'Product page views', 'Conversion rate', 'First-time downloads', 'Proceeds']) {
      await expect(dialog.getByRole('button', { name: new RegExp(`^${tile}`) })).toBeVisible();
    }
    // The chart follows the tile that was clicked.
    await dialog.getByRole('button', { name: /^Conversion rate/ }).click();
    await expect(dialog.getByText('Conversion rate by day')).toBeVisible();
  });

  test('a storefront reading another language leads to the language manager, with that language ticked', async ({ app, page }) => {
    await app.startBlankProject();
    const dialog = await openGrowth(page);
    await section(dialog, 'Insights').click();

    const card = dialog.locator('[data-insight-kind="localize"]').filter({ hasText: 'Japanese' });
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Translate the screenshots' }).click();

    await expect(dialog).toBeHidden();
    const languages = page.getByRole('dialog').filter({ hasText: 'Languages' });
    await expect(languages).toBeVisible();
    await expect(languages.locator('#locale-ja')).toHaveAttribute('data-state', 'checked');
  });

  test('a low rating can be answered, and the reply waits for Apple', async ({ app, page }) => {
    await app.startBlankProject();
    const dialog = await openGrowth(page);
    await section(dialog, 'Reviews').click();

    await dialog.getByRole('combobox', { name: 'Filter by reply' }).click();
    await page.getByRole('option', { name: 'Needs a reply' }).click();
    const review = dialog.locator('[data-review-id]').filter({ hasText: 'Crashes on launch' });
    await review.getByRole('button', { name: 'Reply' }).click();
    await review.getByRole('textbox', { name: 'Reply' }).fill('Thanks for telling us. Version 2.5 fixes the crash on launch.');
    await expect(review.getByText(/stays on this computer/)).toBeVisible();
    await review.getByRole('button', { name: 'Send reply' }).click();

    await expect(review.getByText('Waiting for Apple to check it')).toBeVisible();
    await expect(review).toContainText('Version 2.5 fixes the crash on launch.');
  });

  test('the listing checks fix the keyword field and apply it to the sample', async ({ app, page }) => {
    await app.startBlankProject();
    const dialog = await openGrowth(page);
    await section(dialog, 'Listing').click();

    await expect(dialog.getByText('Spaces after commas use 2 characters')).toBeVisible();
    await dialog.getByRole('button', { name: 'Clean up' }).click();
    const keywords = dialog.locator('#growth-field-keywords');
    await expect(keywords).not.toHaveValue(/, /);
    await expect(keywords).not.toHaveValue(/(^|,)habits?(,|$)/);

    await dialog.getByRole('button', { name: 'Apply to the sample' }).click();
    await expect(dialog.getByText(/Applied 1 change to the sample listing/)).toBeVisible();
    await expect(dialog.getByText('Spaces after commas use 2 characters')).toBeHidden();
  });

  test('the timeline takes an event, and the weekly report has the week in numbers', async ({ app, page, isDesktop }) => {
    await app.startBlankProject();
    const dialog = await openGrowth(page);
    await section(dialog, 'Timeline').click();

    await expect(dialog.getByText('New screenshots uploaded')).toBeVisible();
    await dialog.getByRole('textbox', { name: 'What happened' }).fill('Launched on a podcast');
    await dialog.getByRole('button', { name: 'Add to the timeline' }).click();
    await expect(dialog.locator('[data-event-id]').filter({ hasText: 'Launched on a podcast' })).toBeVisible();

    await section(dialog, 'Reports').click();
    const report = dialog.getByTestId('growth-report');
    await expect(report).toContainText('Week of');
    await expect(report.getByRole('cell', { name: 'First-time downloads' })).toBeVisible();

    if (!isDesktop) {
      const download = page.waitForEvent('download');
      await dialog.getByRole('button', { name: 'Save as Markdown' }).click();
      expect((await download).suggestedFilename()).toMatch(/^Juniper Habit Tracker week \d{4}-\d{2}-\d{2}\.md$/);
    }
  });

  test('listing edits outlast a visit to another section and closing the window', async ({ app, page }) => {
    await app.startBlankProject();
    let dialog = await openGrowth(page);
    await section(dialog, 'Listing').click();
    await dialog.getByRole('button', { name: 'Clean up' }).click();
    const cleaned = await dialog.locator('#growth-field-keywords').inputValue();
    expect(cleaned).not.toMatch(/, /);

    // Each section is a fresh screen; the edit used to go with the old one.
    await section(dialog, 'Reviews').click();
    await section(dialog, 'Listing').click();
    await expect(dialog.locator('#growth-field-keywords')).toHaveValue(cleaned);
    await expect(dialog.getByRole('button', { name: 'Apply to the sample' })).toBeEnabled();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    dialog = await openGrowth(page);
    await section(dialog, 'Listing').click();
    await expect(dialog.locator('#growth-field-keywords')).toHaveValue(cleaned);

    await dialog.getByRole('button', { name: 'Discard all' }).click();
    await expect(dialog.locator('#growth-field-keywords')).toHaveValue(/, /);
  });

  test('a yearly report says what it cannot compare, and saves as a PDF', async ({ app, page, isDesktop, tauri }) => {
    await app.startBlankProject();
    const dialog = await openGrowth(page);
    await section(dialog, 'Reports').click();
    await dialog.getByRole('button', { name: 'Yearly' }).click();

    const report = dialog.getByTestId('growth-report');
    await expect(report).toContainText(/\d{4} so far/);
    // The sample goes back half a year, so the year before has nothing to stand beside.
    await expect(report.getByTestId('growth-report-note')).toContainText('No figure is compared with');

    const download = isDesktop ? null : page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Save as PDF' }).click();
    if (download) {
      const file = await download;
      expect(file.suggestedFilename()).toMatch(/^Juniper Habit Tracker year \d{4}-01-01\.pdf$/);
      const path = await file.path();
      const bytes = (await import('node:fs')).readFileSync(path!);
      expect(bytes.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
      expect(bytes.length).toBeGreaterThan(10_000);
    } else {
      await expect.poll(async () => (await tauri.files()).length, { timeout: 30_000 }).toBe(1);
      const [file] = await tauri.files();
      expect(file.via).toBe('plugin:fs|write_file');
      expect(file.path).toMatch(/Juniper Habit Tracker year \d{4}-01-01\.pdf$/);
      expect(file.bytes).toBeGreaterThan(10_000);
    }
    await expect(dialog.getByRole('button', { name: 'Save as PDF' })).toBeEnabled();
  });
});
