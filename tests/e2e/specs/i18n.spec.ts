import { test, expect, type Page } from '../fixtures/test';
import { waitForProject } from '../fixtures/db';

/**
 * Localization: adding languages, viewing one, and filling its strings in by
 * hand.
 *
 * Everything here runs OFFLINE. The machine-translation paths call an external
 * service (src/services/translation.ts, two NEXT_PUBLIC_TRANSLATION_* hosts,
 * with a /health probe in front of them), and a test that depends on somebody
 * else's server up is a test that fails for the wrong reason. So every flow
 * below turns "fill in machine translations to start from" OFF and types the
 * translation by hand, which is also the path a real localizer uses.
 *
 * The invariant worth protecting, from AGENTS.md rule 1: ProjectLocalization is
 * mirrored onto EVERY artboard, because handleArtboardsUpdate only writes
 * { id, name, timestamp, projectData } and a new top-level field on Project
 * would survive until the next keystroke and then vanish. A translation that
 * does not come back after a reload is exactly that bug returning.
 */

/**
 * This is the heaviest spec in the suite, and it needs more room than the
 * global defaults give it.
 *
 * Most of it runs against a real multi-board template, because localization
 * has nothing to say about an empty canvas, and a locale switch re-renders
 * every board. On its own that is fine; under a full parallel run it is not.
 * Measured on an 8-core machine, serial versus the default four workers:
 *
 *   the manager narrows on a search   11.1s -> 48.6s
 *   a locale survives a reload        18.5s -> timed out past 51.8s
 *   a hand typed translation          17.6s -> timed out past 84s
 *   the CSV export                    11.9s -> 36.8s
 *   removing a language               11.6s -> 36.1s
 *
 * A consistent 3-4x, which is enough to blow the 20s action timeout on a Radix
 * menu that is still animating, and to put the longest test within seconds of
 * the 90s per-test cap. Nothing here is waiting on the app being wrong: every
 * one of these passes serially and on the desktop project. So the fix is
 * headroom, scoped to this file rather than paid for by the other 200 tests.
 */
test.use({ actionTimeout: 45_000 });
test.describe.configure({ timeout: 240_000 });

const GERMAN = 'de-DE';

/** Open the language menu, whichever shape the button is in. */
async function openLanguageMenu(page: Page): Promise<void> {
  // Before any locale exists the control reads "Language"; afterwards it
  // becomes "Showing <language>". Both are the same trigger.
  const collapsed = page.getByRole('button', { name: 'Language', exact: true });
  const expanded = page.locator('button[title^="Showing "]');
  const trigger = (await collapsed.count()) ? collapsed : expanded;
  await trigger.first().click();
  await expect(page.getByRole('menu')).toBeVisible({ timeout: 10_000 });
}

/** Add one locale through the manager, with machine translation switched off. */
async function addLocale(page: Page, code: string, search: string): Promise<void> {
  await openLanguageMenu(page);
  await page.getByRole('menuitem', { name: /Add language|Manage languages/ }).first().click();

  const dialog = page.getByRole('dialog').filter({ hasText: 'Languages' });
  await expect(dialog).toBeVisible({ timeout: 15_000 });

  await dialog.getByRole('textbox', { name: 'Search languages' }).fill(search);
  const checkbox = dialog.locator(`#locale-${code}`);
  await expect(checkbox).toBeVisible({ timeout: 10_000 });
  await checkbox.click();

  // Seeding machine translations would fire the external service. Off means
  // the locale arrives with empty strings, which is what these tests assert on.
  const seed = dialog.getByLabel('Fill in machine translations to start from');
  if ((await seed.count()) && (await seed.getAttribute('aria-checked')) === 'true') {
    await seed.click();
  }

  await dialog.getByRole('button', { name: /^(Add \d+ languages?|Save languages)$/ }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
}

/**
 * The lightest project localization can say anything about: one board, one text
 * layer. Switching locale re-renders every board, so a five board template
 * turns a locale switch into seconds of layout for no extra coverage.
 */
async function openProjectWithText(app: import('../helpers/editor').Editor): Promise<void> {
  await app.startBlankProject();
  await app.ensurePaletteOpen();
  await app.addElementFrom('Basic', 'Text', 'basic:text');
}

/** A project with real text in it, which localization needs to have anything to say. */
async function openTemplateProject(app: import('../helpers/editor').Editor): Promise<void> {
  await app.startDialog.getByRole('tab', { name: /App Screenshots/ }).click();
  await app.startDialog.getByAltText('Somnia Sleep', { exact: true }).click();
  await expect(app.startDialog).toBeHidden({ timeout: 30_000 });
  await expect(app.artboards.first()).toBeVisible({ timeout: 30_000 });
}

test.describe('adding a language', () => {
  test('the manager narrows on a search and adds the locale to the switcher', async ({ app, page }) => {
    await openTemplateProject(app);

    await openLanguageMenu(page);
    await page.getByRole('menuitem', { name: /Add language|Manage languages/ }).first().click();

    const dialog = page.getByRole('dialog').filter({ hasText: 'Languages' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });

    const search = dialog.getByRole('textbox', { name: 'Search languages' });
    await search.fill('zzzz not a language');
    await expect(dialog.getByText(/^No language matches/)).toBeVisible();

    await search.fill('German');
    await expect(dialog.locator(`#locale-${GERMAN}`)).toBeVisible();
    await dialog.locator(`#locale-${GERMAN}`).click();

    const seed = dialog.getByLabel('Fill in machine translations to start from');
    if ((await seed.count()) && (await seed.getAttribute('aria-checked')) === 'true') {
      await seed.click();
    }
    await dialog.getByRole('button', { name: /^(Add \d+ languages?|Save languages)$/ }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });

    // The toolbar control changes shape once a project has a locale: it stops
    // being an invitation and starts naming what is on screen.
    await expect(page.locator('button[title^="Showing "]')).toBeVisible({ timeout: 15_000 });
  });

  test('a locale survives a reload, because it is mirrored onto every artboard', async ({ app, page }) => {
    await openTemplateProject(app);
    await addLocale(page, GERMAN, 'German');
    await waitForProject(page, (project) => !!project.projectData);

    await page.reload();
    await app.waitForBoot();

    await expect(page.locator('button[title^="Showing "]')).toBeVisible({ timeout: 30_000 });
    await openLanguageMenu(page);
    await expect(page.getByRole('menuitemcheckbox', { name: /Deutsch/ })).toBeVisible();
  });
});

test.describe('viewing a language', () => {
  test('switching locale raises the locale strip and Back returns to the base', async ({ app, page }) => {
    await openProjectWithText(app);
    await addLocale(page, GERMAN, 'German');

    await openLanguageMenu(page);
    await page.getByRole('menuitemcheckbox', { name: /Deutsch/ }).click();

    // The strip is the app telling you that edits here are scoped to one
    // language, which is the whole reason the locale view is not silent.
    const strip = page.getByRole('status').filter({ hasText: 'Viewing' });
    await expect(strip).toBeVisible({ timeout: 15_000 });

    // The canvas marks which locale it is drawing, so an export can be checked.
    await expect(page.locator('[data-canvas-locale]').first()).toHaveAttribute(
      'data-canvas-locale',
      GERMAN,
      { timeout: 15_000 }
    );

    await page.getByRole('button', { name: /^Back to / }).click();
    await expect(strip).toBeHidden({ timeout: 15_000 });
  });
});

test.describe('the translations table', () => {
  test('a hand typed translation reaches the canvas and the database', async ({ app, page }) => {
    await openTemplateProject(app);
    await addLocale(page, GERMAN, 'German');

    await openLanguageMenu(page);
    await page.getByRole('menuitem', { name: 'Translations table' }).click();

    const table = page.getByRole('dialog').filter({ hasText: 'Translations' });
    await expect(table).toBeVisible({ timeout: 20_000 });
    await expect(table.getByRole('columnheader').filter({ hasText: 'Deutsch' })).toBeVisible();

    const cell = table.getByRole('textbox').first();
    await expect(cell).toBeVisible({ timeout: 15_000 });
    await cell.fill('Guten Morgen E2E');
    await cell.blur();

    await table.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(table).toBeHidden({ timeout: 20_000 });

    // Switching to German has to show what was just typed. If the string only
    // lived in the dialog's own state this is where it disappears.
    await openLanguageMenu(page);
    await page.getByRole('menuitemcheckbox', { name: /Deutsch/ }).click();
    await expect(page.getByText('Guten Morgen E2E').first()).toBeVisible({ timeout: 20_000 });

    const project = await waitForProject(page, (row) =>
      JSON.stringify(row.projectData).includes('Guten Morgen E2E')
    );
    expect(JSON.stringify(project.projectData)).toContain('Guten Morgen E2E');
  });

  test('the table exports a CSV through the platform it is running on', async ({
    app,
    page,
    tauri,
    isDesktop,
  }) => {
    await openTemplateProject(app);
    await addLocale(page, GERMAN, 'German');

    await openLanguageMenu(page);
    await page.getByRole('menuitem', { name: 'Translations table' }).click();
    const table = page.getByRole('dialog').filter({ hasText: 'Translations' });
    await expect(table).toBeVisible({ timeout: 20_000 });

    if (isDesktop) {
      // WKWebView ignores <a download>, so the desktop build has to go through
      // the native save sheet. That is the assertion, not a download event.
      await table.getByRole('button', { name: 'Export CSV' }).click();
      const save = await tauri.waitForCall('plugin:dialog|save', 20_000);
      expect(JSON.stringify(save.args)).toContain('.csv');
      const files = await tauri.waitForFiles(1, 20_000);
      expect(files[0].path).toMatch(/\.csv$/);
      expect(files[0].bytes).toBeGreaterThan(0);
    } else {
      const download = page.waitForEvent('download', { timeout: 30_000 });
      await table.getByRole('button', { name: 'Export CSV' }).click();
      const file = await download;
      expect(file.suggestedFilename()).toMatch(/\.csv$/);
    }
  });
});

test.describe('removing a language', () => {
  test('the manager warns before it drops a locale and its strings', async ({ app, page }) => {
    await openTemplateProject(app);
    await addLocale(page, GERMAN, 'German');

    await openLanguageMenu(page);
    await page.getByRole('menuitem', { name: 'Manage languages' }).click();

    const dialog = page.getByRole('dialog').filter({ hasText: 'Languages' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await dialog.locator(`#locale-${GERMAN}`).click();

    // Deleting somebody's translations silently would be the worst kind of
    // data loss, so the warning is part of the contract.
    await expect(dialog.getByText(/deletes (its|their) translations/)).toBeVisible();

    await dialog.getByRole('button', { name: /^(Add \d+ languages?|Save languages)$/ }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });

    await expect(page.getByRole('button', { name: 'Language', exact: true })).toBeVisible({
      timeout: 20_000,
    });
  });
});
