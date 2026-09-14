import { test, expect } from '../fixtures/test';
import { readProjects, waitForProject } from '../fixtures/db';

/**
 * Templates are the app's main on-ramp: 101 JSON files under
 * public/data/projects/, registered in src/lib/templateCategories.ts, offered
 * from the start dialog and from the toolbar's Select Template button.
 *
 * Nothing else discovers a template. A file that is not in
 * TEMPLATE_CATEGORIES[].files simply is not there, and a template whose JSON no
 * longer parses fails at the moment somebody picks it. Both are exactly the
 * kind of break that ships unnoticed, which is what these tests are for.
 */

/** A template known to be in the App Screenshots category. */
const TEMPLATE = 'Somnia Sleep';

test.describe('templates', () => {
  test('the start dialog offers every category with a populated count', async ({ app }) => {
    const dialog = app.startDialog;
    await expect(dialog).toBeVisible();

    // The counts come from TEMPLATE_CATEGORIES[].files.length, so a zero here
    // means a whole category stopped being registered.
    for (const category of [/App Screenshots \d+/, /Apple Watch \d+/, /Mac \d+/, /App Preview Videos \d+/, /Google Feature Graphic \d+/]) {
      await expect(dialog.getByRole('tab', { name: category })).toBeVisible();
    }
  });

  test('picking a template loads its whole project onto the canvas', async ({ app, page }) => {
    const dialog = app.startDialog;
    await dialog.getByRole('tab', { name: /App Screenshots/ }).click();

    // Cards are images, not buttons: the preview PNG carries the template name
    // as its alt text and the card around it takes the click.
    const card = dialog.getByAltText(TEMPLATE, { exact: true });
    await expect(card).toBeVisible({ timeout: 30_000 });
    // The preview is a local public asset, so it must load even with the
    // network cut off. A broken path here shows as an empty template picker.
    await expect(card).toHaveAttribute('src', /\/data\/projects\/previews\//);
    await card.click();

    await expect(dialog).toBeHidden({ timeout: 30_000 });

    // A real template is a multi-board deck with content on every board, which
    // is what separates "the template loaded" from "an empty project opened".
    await expect(app.artboards).toHaveCount(5, { timeout: 30_000 });
    const elements = page.locator('[data-artboard-dom-id] [data-element-id]');
    await expect(elements.first()).toBeVisible();
    expect(await elements.count()).toBeGreaterThan(20);

    // Templates are authored at the required App Store size and must not be
    // silently rescaled on the way in.
    await expect(app.board(0)).toHaveAttribute('data-original-width', '1290');
    await expect(app.board(0)).toHaveAttribute('data-original-height', '2796');
  });

  test('a picked template is persisted, so a reload does not lose it', async ({ app, page }) => {
    await app.startDialog.getByRole('tab', { name: /App Screenshots/ }).click();
    await app.startDialog.getByAltText(TEMPLATE, { exact: true }).click();
    await expect(app.artboards).toHaveCount(5, { timeout: 30_000 });

    const boardsBefore = await app.artboards.count();
    const elementsBefore = await page.locator('[data-artboard-dom-id] [data-element-id]').count();
    await waitForProject(page, (project) => Array.isArray(project.projectData) || typeof project.projectData === 'object');

    await page.reload();
    await app.waitForBoot();

    // The start dialog must NOT come back: there is a project now.
    await expect(app.startDialog).toBeHidden();
    await expect(app.artboards).toHaveCount(boardsBefore, { timeout: 30_000 });
    await expect(page.locator('[data-artboard-dom-id] [data-element-id]')).toHaveCount(elementsBefore, {
      timeout: 30_000,
    });

    const projects = await readProjects(page);
    expect(projects).toHaveLength(1);
  });

  test('the toolbar can swap the template of an open project', async ({ app }) => {
    await app.startBlankProject();
    await expect(app.artboards).toHaveCount(1);

    await app.selectTemplateButton.click();
    const dialog = app.startDialog;
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await dialog.getByRole('tab', { name: /App Screenshots/ }).click();
    await dialog.getByAltText(TEMPLATE, { exact: true }).click();

    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expect(app.artboards).toHaveCount(5, { timeout: 30_000 });
  });
});
