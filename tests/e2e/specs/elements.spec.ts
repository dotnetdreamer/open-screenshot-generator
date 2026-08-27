import { test, expect, type Page } from '../fixtures/test';
import { canvasBottomBarsOverlap } from '../helpers/canvas';
import type { Locator } from '@playwright/test';
import { Editor } from '../helpers/editor';
import { waitForProject, type StoredProject } from '../fixtures/db';

/**
 * Adding, selecting, reordering and deleting elements, plus undo/redo.
 *
 * The local helpers below exist because the shared ones stop at "how many
 * elements are on the board", and this file needs to know which ones, in what
 * order. The two that carry the file:
 *
 *  - `elementIdsOn` reads DOM order, which IS z-order: Artboard.tsx renders
 *    `elements.map(...)` straight out of the array, so the last node paints on
 *    top. That is the only observable difference "Move layer up" makes.
 *  - `layerRow` climbs from the row's rename button to the row itself, which is
 *    where the up / down / delete buttons live. The rename title carries the
 *    element's display name, so it is the one handle that names a row.
 */

async function elementIdsOn(board: Locator): Promise<string[]> {
  return board.evaluate((node) =>
    Array.from(node.querySelectorAll('[data-element-id]')).map(
      (el) => el.getAttribute('data-element-id') ?? ''
    )
  );
}

function layerRow(page: Page, label: string): Locator {
  return page.getByTitle(`Double-click to rename "${label}"`).locator('xpath=..');
}

/**
 * Every layer row on screen, whatever it is called.
 * The trailing quote matters: the project name field and the artboard caption
 * both say "Double-click to rename" too, and neither names an element.
 */
function layerRows(page: Page): Locator {
  return page.getByTitle(/^Double-click to rename "/);
}

/**
 * The toolbar's Redo button.
 *
 * Not `app.redoButton`: that is `getByTitle(/^Redo/)`, and an undone History
 * row is titled `Redo up to "Add Element"`, so the shared locator stops being
 * strict-mode safe the moment this file opens the History tab.
 */
function toolbarRedo(page: Page): Locator {
  return page.getByTitle(/^Redo \(/);
}

/** The "N of M" counter in the History tab, as a pair. */
async function historyCounter(app: Editor): Promise<{ index: number; total: number }> {
  const text = (await app.activeDockPanel.getByText(/^\d+ of \d+$/).innerText()).trim();
  const [index, total] = text.split(' of ').map((v) => Number.parseInt(v, 10));
  return { index, total };
}

/** The element ids inside a saved project row, board by board, in array order. */
function persistedElementIds(project: StoredProject): string[] {
  const artboards = (project.projectData as Array<{ elements?: Array<{ id?: string }> }>) ?? [];
  return artboards.flatMap((artboard) => (artboard.elements ?? []).map((el) => el.id ?? ''));
}

/**
 * Click the middle of an element with a real pointer.
 *
 * `locator.click()` is not enough here: it targets the element's own centre,
 * and the canvas is a stack of overlapping absolutely positioned boxes, so
 * Playwright's actionability check can decide the node is covered. The board is
 * scaled by a CSS transform, but a bounding box is already in page pixels, so
 * no conversion is needed on the way in.
 */
async function clickElementCentre(page: Page, element: Locator): Promise<void> {
  const box = await element.boundingBox();
  if (!box) throw new Error('The element has no bounding box; is it on screen?');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test.describe('adding elements', () => {
  test('three Basic tiles land as three elements and three layer rows', async ({ app, page }) => {
    await app.startBlankProject();
    await app.ensurePaletteOpen();

    await app.addElementFrom('Basic', 'Text', 'basic:text');
    await app.addElement('Rectangle', 'basic:rectangle');
    await app.addElement('Circle', 'basic:circle');

    await expect(app.elementsOn(0)).toHaveCount(3);
    const ids = await elementIdsOn(app.board(0));
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(id).toMatch(/^el_/);

    // The layer list is the same three, reversed: topmost first.
    await expect(app.layersHeader).toBeVisible();
    await expect(layerRows(page)).toHaveCount(3);
    await expect(layerRow(page, 'Circle Shape')).toBeVisible();
    await expect(layerRow(page, 'Rectangle Shape')).toBeVisible();
    await expect(layerRow(page, 'New Text')).toBeVisible();
  });

  test('a text tile arrives with the seeded defaults and the scaled font size', async ({ app }) => {
    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await app.addElementFrom('Basic', 'Text', 'basic:text');

    const body = app.elementsOn(0).first().locator('[data-text-body="true"]');
    await expect(body).toHaveText('New Text');
    // AGENTS.md rule 3: text renders at fontSize / 0.3 and ignores element.scale,
    // so the 48 the palette seeds has to reach the DOM as 160px. Anything else
    // means the export and the canvas have stopped agreeing.
    await expect(body).toHaveCSS('font-size', '160px');
  });

  test('a Devices tile adds through the second registration site', async ({ app, page }) => {
    await app.startBlankProject();
    await app.ensurePaletteOpen();

    // Not the Elements tab: devices go through their own tile component and
    // their own add path, so a break there is invisible to the Basic tests.
    await app.paletteTab('Devices').click();
    await app.openPaletteCategory('Device Mockups');
    await app.addElement('iPhone', 'device:iphone');

    await expect(app.elementsOn(0)).toHaveCount(1);
    await expect(layerRow(page, 'Iphone Device')).toBeVisible();
    await expect(app.activeDockPanel.getByText('Device Properties')).toBeVisible();
  });
});

test.describe('selecting elements', () => {
  test('clicking a shape on the canvas outlines it and opens Shape Properties', async ({ app, page }) => {
    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await app.addElementFrom('Basic', 'Rectangle', 'basic:rectangle');

    const rectangle = app.elementsOn(0).first();
    const id = await rectangle.getAttribute('data-element-id');
    await clickElementCentre(page, rectangle);

    await expect(app.selectedElement).toHaveCount(1);
    await expect(app.selectedElement).toHaveAttribute('data-element-id', String(id));
    await expect(app.activeDockPanel.getByText('Shape Properties')).toBeVisible();
  });

  test('clicking a text element opens Text Properties with its content loaded', async ({ app, page }) => {
    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await app.addElementFrom('Basic', 'Text', 'basic:text');

    await clickElementCentre(page, app.elementsOn(0).first());

    await expect(app.activeDockPanel.getByText('Text Properties')).toBeVisible();
    await expect(app.textContentInput).toHaveValue('New Text');
    await expect(app.fontSizeInput).toHaveValue('48');
  });

  test('a layer row selects the element it names', async ({ app, page }) => {
    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await app.addElementFrom('Basic', 'Rectangle', 'basic:rectangle');
    await app.addElement('Circle', 'basic:circle');

    const ids = await elementIdsOn(app.board(0));
    const rectangleId = ids[0];

    await page.getByTitle('Double-click to rename "Rectangle Shape"').click();

    await expect(app.selectedElement).toHaveAttribute('data-element-id', rectangleId);
    await expect(app.activeDockPanel.getByText('Shape Properties')).toBeVisible();
  });
});

test.describe('ordering and deleting', () => {
  test('Move layer down repaints the element behind its neighbour', async ({ app, page }) => {
    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await app.addElementFrom('Basic', 'Rectangle', 'basic:rectangle');
    await app.addElement('Circle', 'basic:circle');

    const [rectangleId, circleId] = await elementIdsOn(app.board(0));
    // Added last, so the circle paints last, so it is the top layer.
    expect(await layerRows(page).first().getAttribute('title')).toContain('Circle Shape');

    await layerRow(page, 'Circle Shape').getByTitle('Move layer down').click();
    await expect
      .poll(() => elementIdsOn(app.board(0)))
      .toEqual([circleId, rectangleId]);

    await layerRow(page, 'Circle Shape').getByTitle('Move layer up').click();
    await expect
      .poll(() => elementIdsOn(app.board(0)))
      .toEqual([rectangleId, circleId]);
  });

  test('the top layer cannot climb and the bottom layer cannot sink', async ({ app, page }) => {
    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await app.addElementFrom('Basic', 'Rectangle', 'basic:rectangle');
    await app.addElement('Circle', 'basic:circle');

    await expect(layerRow(page, 'Circle Shape').getByTitle('Move layer up')).toBeDisabled();
    await expect(layerRow(page, 'Rectangle Shape').getByTitle('Move layer down')).toBeDisabled();
  });

  test('Delete element takes it off the board and out of the layer list', async ({ app, page }) => {
    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await app.addElementFrom('Basic', 'Rectangle', 'basic:rectangle');
    await app.addElement('Circle', 'basic:circle');

    const [rectangleId] = await elementIdsOn(app.board(0));

    await layerRow(page, 'Circle Shape').getByTitle('Delete element').click();

    await expect(app.elementsOn(0)).toHaveCount(1);
    await expect(layerRows(page)).toHaveCount(1);
    await expect(layerRow(page, 'Circle Shape')).toHaveCount(0);
    expect(await elementIdsOn(app.board(0))).toEqual([rectangleId]);
  });

  test('an addition and a deletion both reach the local database', async ({ app, page }) => {
    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await app.addElementFrom('Basic', 'Rectangle', 'basic:rectangle');
    const [rectangleId] = await elementIdsOn(app.board(0));

    // On screen is not the same as saved: the Dexie write is debounced behind
    // handleArtboardsUpdate, and a reload reads the row, not the canvas.
    const saved = await waitForProject(page, (project) =>
      persistedElementIds(project).includes(rectangleId)
    );
    expect(persistedElementIds(saved)).toEqual([rectangleId]);

    await layerRow(page, 'Rectangle Shape').getByTitle('Delete element').click();
    await expect(app.elementsOn(0)).toHaveCount(0);
    await waitForProject(page, (project) => persistedElementIds(project).length === 0);
  });

  test('Backspace deletes the element the canvas has selected', async ({ app, page }) => {
    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await app.addElementFrom('Basic', 'Rectangle', 'basic:rectangle');

    await clickElementCentre(page, app.elementsOn(0).first());
    await expect(app.selectedElement).toHaveCount(1);

    await page.keyboard.press('Backspace');

    await expect(app.elementsOn(0)).toHaveCount(0);
    await expect(layerRows(page)).toHaveCount(0);
    // Losing the last element must not take the artboard with it: the same key
    // deletes the ARTBOARD when nothing is selected.
    await expect(app.artboards).toHaveCount(1);
  });
});

test.describe('undo and redo', () => {
  test('the toolbar walks two additions back and forward again', async ({ app, page }) => {
    await app.startBlankProject();
    await app.ensurePaletteOpen();
    // The canvas tool bar and the zoom pill overlap below about 1280px, which
    // leaves these controls covered. responsive.spec.ts owns that defect; a
    // second red mark for it here would only make the report harder to read.
    test.skip(
      await canvasBottomBarsOverlap(page),
      'the zoom pill covers the canvas tool bar at this width, see responsive.spec.ts'
    );
    await app.dockTab('History').click();

    const before = await historyCounter(app);

    await app.addElementFrom('Basic', 'Rectangle', 'basic:rectangle');
    await app.addElement('Circle', 'basic:circle');
    const ids = await elementIdsOn(app.board(0));

    await expect.poll(() => historyCounter(app)).toEqual({
      index: before.total + 2,
      total: before.total + 2,
    });

    await app.undoButton.click();
    await expect(app.elementsOn(0)).toHaveCount(1);
    await app.undoButton.click();
    await expect(app.elementsOn(0)).toHaveCount(0);
    await expect(layerRows(page)).toHaveCount(0);
    // Undo rewinds the pointer; it does not throw the redo tail away.
    await expect.poll(() => historyCounter(app)).toEqual({
      index: before.total,
      total: before.total + 2,
    });

    await toolbarRedo(page).click();
    await toolbarRedo(page).click();
    await expect(app.elementsOn(0)).toHaveCount(2);
    // Same elements, same order: a redo that re-created them would hand out new ids.
    expect(await elementIdsOn(app.board(0))).toEqual(ids);
    await expect.poll(() => historyCounter(app)).toEqual({
      index: before.total + 2,
      total: before.total + 2,
    });
  });

  test('the keyboard shortcut undoes and redoes the same step', async ({ app, page, isDesktop }) => {
    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await app.addElementFrom('Basic', 'Rectangle', 'basic:rectangle');
    await expect(app.elementsOn(0)).toHaveCount(1);

    // The shortcut is bound on window with (ctrlKey || metaKey), so both
    // modifiers work on both hosts; ControlOrMeta picks the platform's own.
    const modifier = isDesktop ? 'Meta' : 'ControlOrMeta';
    await page.keyboard.press(`${modifier}+z`);
    await expect(app.elementsOn(0)).toHaveCount(0);

    await page.keyboard.press(`${modifier}+Shift+z`);
    await expect(app.elementsOn(0)).toHaveCount(1);
  });
});
