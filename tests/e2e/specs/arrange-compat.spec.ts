import { test, expect } from '../fixtures/test';

import { waitForProject } from '../fixtures/db';

/** A template known to be in the App Screenshots category. */
const TEMPLATE = 'Somnia Sleep';

/**
 * What multi-select, grouping and the geometry fields must NOT do to work a
 * user already has.
 *
 * Nothing in this change adds a stored field: `groupId` was already on
 * BaseElement and is still the only one grouping writes. So the contract these
 * tests hold is that an existing project keeps its geometry, keeps rendering
 * the same, and never picks up a group it was not given.
 */

/** Every element on every board of the saved row, with its stored geometry. */
function storedGeometry(project: { projectData?: unknown }): Array<Record<string, unknown>> {
  const artboards =
    (project.projectData as Array<{ elements?: Array<Record<string, unknown>> }>) ?? [];
  return artboards.flatMap((board) => board.elements ?? []);
}

test.describe('projects made before grouping existed', () => {
  test('a shipped template opens with its layers exactly where it left them', async ({ app, page }) => {
    // A real multi-board template, which is what an existing user's project
    // looks like: dozens of layers laid out by hand, none of them grouped.
    const dialog = app.startDialog;
    await dialog.getByRole('tab', { name: /App Screenshots/ }).click();
    const card = dialog.getByAltText(TEMPLATE, { exact: true });
    await expect(card).toBeVisible({ timeout: 30_000 });
    await card.click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expect(app.elementsOn(0).first()).toBeVisible({ timeout: 45_000 });

    const before = await app.elementsOn(0).evaluateAll((nodes) =>
      nodes.map((node) => {
        const style = (node as HTMLElement).style;
        return `${style.left}|${style.top}|${style.width}|${style.height}|${style.transform}`;
      })
    );
    expect(before.length).toBeGreaterThan(0);

    // A reload replays the stored project through the same loader an existing
    // user's project takes.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await app.waitForBoot();
    await expect(app.elementsOn(0).first()).toBeVisible({ timeout: 45_000 });

    const after = await app.elementsOn(0).evaluateAll((nodes) =>
      nodes.map((node) => {
        const style = (node as HTMLElement).style;
        return `${style.left}|${style.top}|${style.width}|${style.height}|${style.transform}`;
      })
    );
    expect(after).toEqual(before);
  });

  test('clicking one layer of an ungrouped project selects only that layer', async ({ app, page }) => {
    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await app.addElementFrom('Basic', 'Rectangle', 'basic:rectangle');
    await app.addElement('Circle', 'basic:circle');

    // Nothing here was ever grouped, which is true of every shipped template
    // and every project saved before this change.
    await page.getByTitle('Double-click to rename "Rectangle Shape"').click();
    await page.waitForTimeout(250);
    await expect(app.activeDockPanel.getByText(/^\d+ elements selected$/)).toBeHidden();
    await expect(app.activeDockPanel.getByText('Shape Properties')).toBeVisible();
  });

  test('grouping and ungrouping again leaves no group tag in the saved project', async ({ app, page }) => {
    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await app.addElementFrom('Basic', 'Rectangle', 'basic:rectangle');
    await app.addElement('Circle', 'basic:circle');

    await page.getByTitle('Double-click to rename "Rectangle Shape"').click();
    await page.getByTitle('Double-click to rename "Circle Shape"').click({ modifiers: ['Shift'] });
    await app.activeDockPanel.getByTitle('Group elements (Ctrl+G)').click();
    await page.waitForTimeout(400);

    const grouped = await waitForProject(page, (project) =>
      storedGeometry(project).some((el) => typeof el.groupId === 'string')
    );
    expect(storedGeometry(grouped).filter((el) => typeof el.groupId === 'string')).toHaveLength(2);

    await app.activeDockPanel.getByTitle('Ungroup elements (Ctrl+Shift+G)').click();
    await page.waitForTimeout(400);

    // The key is removed, not set to undefined: Dexie stores a structured
    // clone, which would keep a `groupId` key holding nothing.
    const freed = await waitForProject(page, (project) =>
      storedGeometry(project).every((el) => !('groupId' in el))
    );
    for (const element of storedGeometry(freed)) {
      expect('groupId' in element).toBe(false);
    }
  });

  test('a pasted copy does not join the group its original belongs to', async ({ app, page, isDesktop }) => {
    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await app.addElementFrom('Basic', 'Rectangle', 'basic:rectangle');
    await app.addElement('Circle', 'basic:circle');

    await page.getByTitle('Double-click to rename "Rectangle Shape"').click();
    await page.getByTitle('Double-click to rename "Circle Shape"').click({ modifiers: ['Shift'] });
    await app.activeDockPanel.getByTitle('Group elements (Ctrl+G)').click();
    await page.waitForTimeout(400);

    // Copy one member and paste it.
    await page.getByTitle('Double-click to rename "Rectangle Shape"').click({ modifiers: ['Alt'] });
    await page.waitForTimeout(250);
    const modifier = isDesktop ? 'Meta' : 'Control';
    await page.keyboard.press(`${modifier}+c`);
    await page.waitForTimeout(200);
    await page.keyboard.press(`${modifier}+v`);
    await page.waitForTimeout(500);

    await expect(app.elementsOn(0)).toHaveCount(3);
    const stored = await waitForProject(page, (project) => storedGeometry(project).length === 3);
    const tagged = storedGeometry(stored).filter((el) => typeof el.groupId === 'string');
    // Still the original two. A copy that inherited the tag would move with an
    // arrangement nobody added it to.
    expect(tagged).toHaveLength(2);
  });
});
