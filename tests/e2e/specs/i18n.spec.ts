import { test, expect, type Page } from '../fixtures/test';
import { put, waitForProject } from '../fixtures/db';

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

test.describe("translating with the user's own AI", () => {
  /** What Claude Code's detect answers when it is signed in on a Max plan (ClaudeDetection). */
  const CLAUDE_READY = {
    found: true,
    path: '/Users/e2e/.local/bin/claude',
    version: '2.1.285 (Claude Code)',
    loggedIn: true,
    authMethod: 'claude.ai',
    subscriptionType: 'max',
  };
  const GERMAN_COPY = 'Jeden Tag ein bisschen';
  const OVERWRITTEN = 'Überschrieben';
  // Every prompt gets this answer. A run asks for s1 first, and s2 only when
  // it sends a second string; an id nobody asked for is dropped.
  test.use({
    tauriConfig: {
      responses: {
        abs_claude_detect: CLAUDE_READY,
        abs_claude_prompt: JSON.stringify({ s1: GERMAN_COPY, s2: OVERWRITTEN }),
      },
    },
  });

  test('Claude Code fills in a new language, and the free translator is never asked', async ({
    app,
    page,
    tauri,
    isDesktop,
  }) => {
    test.skip(!isDesktop, 'Claude Code runs in the desktop app');
    // Our translation server, wherever this build points it. A user with an
    // AI of their own never sends it anything, not even a /health probe.
    const serverRequests: string[] = [];
    await page.route(
      (url) => /\/(translate|detect|health)$/.test(url.pathname),
      async (route) => {
        serverRequests.push(route.request().url());
        await route.abort();
      }
    );
    await openProjectWithText(app);

    await openLanguageMenu(page);
    await page.getByRole('menuitem', { name: /Add language|Manage languages/ }).first().click();
    const dialog = page.getByRole('dialog').filter({ hasText: 'Languages' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole('textbox', { name: 'Search languages' }).fill('German');
    await dialog.locator(`#locale-${GERMAN}`).click();
    const seed = dialog.getByLabel('Fill in machine translations to start from');
    await expect(seed).toBeEnabled({ timeout: 15_000 });
    if ((await seed.getAttribute('aria-checked')) !== 'true') await seed.click();
    await dialog.getByRole('button', { name: /^(Add \d+ languages?|Save languages)$/ }).click();

    const prompt = await tauri.waitForCall('abs_claude_prompt', 30_000);
    expect(String(prompt.args.system)).toContain('into German (Deutsch, de-DE)');
    expect(String(prompt.args.prompt)).toContain('"s1":');
    const project = await waitForProject(
      page,
      (stored) => JSON.stringify(stored.projectData).includes(GERMAN_COPY),
      30_000
    );
    expect(JSON.stringify(project.projectData)).toContain('"origin":"auto"');
    expect(serverRequests).toEqual([]);
    expect(await tauri.unhandled()).toEqual([]);
  });

  test("translating one text leaves another artboard's typed German alone, in a project that came in with a repeated id", async ({
    app,
    page,
    tauri,
    isDesktop,
  }) => {
    test.skip(!isDesktop, 'Claude Code runs in the desktop app');
    // Opening a project gives a repeated id a fresh one (ensureUniqueElementIds)
    // and moves its translations with it; the button also names its artboard.
    // The second artboard's German is typed by a person, and this button
    // includes typed copy.
    const TYPED = 'Keine Serie reißt ab';
    const localization = { baseLocale: 'en-US', locales: [{ code: GERMAN }] };
    const board = (id: string, x: number, content: string, extra: Record<string, unknown> = {}) => ({
      id,
      name: id,
      position: { x, y: 50 },
      size: { width: 1290, height: 2796 },
      backgroundColor: '#ffffff',
      zoom: 1,
      localization,
      elements: [
        {
          id: 'shared-headline',
          type: 'text',
          name: 'Headline',
          position: { x: 100, y: 300 },
          size: { width: 1090, height: 300 },
          rotation: 0,
          scale: 1,
          content,
          fontSize: 30,
          color: '#111111',
          fontFamily: 'Inter',
          fontWeight: '700',
          textAlign: 'center',
        },
      ],
      ...extra,
    });
    const projectId = 'proj_shared_ids';
    await expect(app.startDialog).toBeVisible();
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              new Promise<boolean>((resolve) => {
                const open = indexedDB.open('ProjectDatabase');
                open.onerror = () => resolve(false);
                open.onsuccess = () => {
                  const has = open.result.objectStoreNames.contains('projects');
                  open.result.close();
                  resolve(has);
                };
              })
          ),
        { timeout: 30_000 }
      )
      .toBe(true);
    await put(page, 'projects', {
      id: projectId,
      name: 'Shared ids',
      timestamp: new Date('2026-11-14T10:00:00.000Z'),
      projectData: [
        board('ab_first', 50, 'Track every habit'),
        board('ab_second', 1500, 'Never break a streak', {
          localized: { [GERMAN]: { 'shared-headline': { content: TYPED, origin: 'manual' } } },
        }),
      ],
    });
    await app.goto(`/?projectId=${projectId}`);
    await expect(app.board(0).locator('[data-element-id="shared-headline"]')).toBeVisible({ timeout: 30_000 });

    await openLanguageMenu(page);
    await page.getByRole('menuitemcheckbox', { name: /Deutsch/ }).click();
    await app.board(0).locator('[data-element-id="shared-headline"]').click();
    await page.getByRole('button', { name: 'Translate this text' }).click();

    const prompt = await tauri.waitForCall('abs_claude_prompt', 30_000);
    expect(String(prompt.args.prompt)).toContain('Track every habit');
    expect(String(prompt.args.prompt)).not.toContain('Never break a streak');
    const stored = await waitForProject(
      page,
      (candidate) => candidate.id === projectId && JSON.stringify(candidate.projectData).includes(GERMAN_COPY),
      30_000
    );
    const [first, second] = stored.projectData as Array<{
      elements: Array<{ id: string; type: string }>;
      localized?: Record<string, Record<string, { content?: string; origin?: string }>>;
    }>;
    expect(first.localized?.[GERMAN]?.['shared-headline']?.content).toBe(GERMAN_COPY);
    const renamed = second.elements.find((element) => element.type === 'text')!.id;
    expect(renamed).not.toBe('shared-headline');
    expect(second.localized?.[GERMAN]?.[renamed]).toEqual({ content: TYPED, origin: 'manual' });
    expect(JSON.stringify(stored.projectData)).not.toContain(OVERWRITTEN);
  });

  test("the translations table saves what Translate empty wrote, with nothing typed by hand", async ({
    app,
    page,
    tauri,
    isDesktop,
  }) => {
    test.skip(!isDesktop, 'Claude Code runs in the desktop app');
    // The table holds a machine run until Save, and Save used to count only
    // what was typed, so a run on its own could not be saved at all.
    await openProjectWithText(app);
    await openLanguageMenu(page);
    await page.getByRole('menuitem', { name: /Add language|Manage languages/ }).first().click();
    const manager = page.getByRole('dialog').filter({ hasText: 'Languages' });
    await expect(manager).toBeVisible({ timeout: 15_000 });
    await manager.getByRole('textbox', { name: 'Search languages' }).fill('German');
    await manager.locator(`#locale-${GERMAN}`).click();
    // Off, and only once it can be on: the switch turns on by itself when the
    // look for Claude Code lands, and German would then arrive translated.
    const seed = manager.getByLabel('Fill in machine translations to start from');
    await expect(seed).toBeEnabled({ timeout: 15_000 });
    if ((await seed.getAttribute('aria-checked')) === 'true') await seed.click();
    await manager.getByRole('button', { name: /^(Add \d+ languages?|Save languages)$/ }).click();
    await expect(manager).toBeHidden({ timeout: 20_000 });

    await openLanguageMenu(page);
    await page.getByRole('menuitemcheckbox', { name: /Deutsch/ }).click();
    await openLanguageMenu(page);
    await page.getByRole('menuitem', { name: 'Translations table' }).click();
    const table = page.getByRole('dialog').filter({ hasText: 'Translate empty' });
    await expect(table).toBeVisible({ timeout: 20_000 });

    await table.getByRole('button', { name: 'Translate empty' }).click();
    await tauri.waitForCall('abs_claude_prompt', 30_000);
    await expect(table.getByRole('textbox').first()).toHaveValue(GERMAN_COPY, { timeout: 30_000 });
    const save = table.getByRole('button', { name: 'Save', exact: true });
    await expect(save).toBeEnabled();
    await expect(table.getByText('1 string translated, press Save to keep them')).toBeVisible();
    await save.click();
    await expect(table).toBeHidden({ timeout: 20_000 });

    const project = await waitForProject(
      page,
      (stored) => JSON.stringify(stored.projectData).includes(GERMAN_COPY),
      30_000
    );
    expect(JSON.stringify(project.projectData)).toContain('"origin":"auto"');
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
