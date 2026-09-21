import { test, expect, type Page } from '../fixtures/test';
import type { Locator } from '@playwright/test';
import { boardGeometry, elementPosition, pointerDrag, toPagePoint } from '../helpers/canvas';
import { Editor } from '../helpers/editor';

/**
 * Selecting several layers, and the four things you can then do to them:
 * group them, align them, spread them out, and nudge them with the arrow keys.
 * Plus the X/Y/W/H fields, which are the same geometry reached by typing.
 *
 * Everything here asserts on the geometry the CANVAS ended up rendering, read
 * off the inline style the app writes, not on what a control says. A board is
 * laid out at its full store resolution and shrunk by a CSS transform, so
 * `style.left` is in artboard pixels while a bounding box is in screen pixels;
 * `elementPosition` reads the former, which is the number the project stores.
 */

/**
 * The three shapes every test here starts from, in the order they were added.
 *
 * DOM order is array order is z-order, so `elementsOn(0).nth(i)` lines up with
 * this list. They all land on the same default spot, which is why nothing here
 * picks a layer by clicking the canvas until they have been spread out.
 */
const SHAPES = ['Rectangle Shape', 'Circle Shape', 'Triangle Shape'];

async function threeShapes(app: Editor): Promise<void> {
  await app.startBlankProject();
  await app.ensurePaletteOpen();
  await app.addElementFrom('Basic', 'Rectangle', 'basic:rectangle');
  await app.addElement('Circle', 'basic:circle');
  await app.addElement('Triangle', 'basic:triangle');
  await expect(app.elementsOn(0)).toHaveCount(3);
}

/**
 * Pick a layer by name, from the Layers list.
 *
 * Unambiguous where a canvas click is not: freshly added shapes sit exactly on
 * top of one another, so the press only ever reaches whichever one paints last.
 */
async function selectLayer(page: Page, label: string, modifier?: 'Shift' | 'Alt'): Promise<void> {
  const row = page.getByTitle(`Double-click to rename "${label}"`);
  await row.waitFor({ timeout: 15000 });
  if (modifier) await page.keyboard.down(modifier);
  await row.click();
  if (modifier) await page.keyboard.up(modifier);
  await page.waitForTimeout(150);
}

/** Put one layer at a known spot, so an assertion has something exact to check. */
async function placeAt(page: Page, app: Editor, label: string, x: number, y: number): Promise<void> {
  await selectLayer(page, label);
  await setField(page, app, '#elementX', x);
  await setField(page, app, '#elementY', y);
}

/** Spread the three shapes out so a canvas click can only land on one of them. */
async function spreadOut(page: Page, app: Editor): Promise<void> {
  await placeAt(page, app, SHAPES[0], 100, 100);
  await placeAt(page, app, SHAPES[1], 100, 700);
  await placeAt(page, app, SHAPES[2], 100, 1900);
}

async function setField(page: Page, app: Editor, selector: string, value: number): Promise<void> {
  const field = app.activeDockPanel.locator(selector);
  await field.waitFor({ timeout: 15000 });
  await field.fill(String(value));
  await field.press('Enter');
  await page.waitForTimeout(150);
}

/**
 * Click an element with a real pointer.
 *
 * The canvas is a stack of overlapping absolutely positioned boxes and every
 * interaction is a pointer event, so `locator.click()` can be refused as
 * covered. Modifiers go through `page.keyboard` around the press, because the
 * app reads `shiftKey` off the pointerdown itself.
 */
async function clickElement(
  page: Page,
  element: Locator,
  modifier?: 'Shift' | 'Alt'
): Promise<void> {
  const box = await element.boundingBox();
  if (!box) throw new Error('The element has no bounding box; is it on screen?');
  if (modifier) await page.keyboard.down(modifier);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  if (modifier) await page.keyboard.up(modifier);
  await page.waitForTimeout(120);
}

/** How many layers the Properties panel says are selected, or 1/0 for its other states. */
async function selectionCount(app: Editor): Promise<number> {
  const header = app.activeDockPanel.getByText(/^\d+ elements selected$/);
  if (await header.isVisible().catch(() => false)) {
    const text = await header.innerText();
    return Number.parseInt(text, 10);
  }
  return 0;
}

test.describe('selecting several layers', () => {
  test('shift-clicking a second layer selects both, and shift-clicking it again lets it go', async ({ app, page }) => {
    await threeShapes(app);
    await spreadOut(page, app);

    await clickElement(page, app.elementsOn(0).nth(0));
    // One layer is the ordinary properties form, not the arrange section.
    expect(await selectionCount(app)).toBe(0);

    await clickElement(page, app.elementsOn(0).nth(1), 'Shift');
    expect(await selectionCount(app)).toBe(2);

    await clickElement(page, app.elementsOn(0).nth(2), 'Shift');
    expect(await selectionCount(app)).toBe(3);

    // Shift on a layer already in the set takes it back out. This is the case
    // that used to start a drag instead, because a press on a selected element
    // never reached the select handler.
    await clickElement(page, app.elementsOn(0).nth(2), 'Shift');
    expect(await selectionCount(app)).toBe(2);
  });

  test('deleting one member leaves the rest of the selection alone', async ({ app, page }) => {
    await threeShapes(app);
    await spreadOut(page, app);

    await selectLayer(page, SHAPES[0]);
    await selectLayer(page, SHAPES[1], 'Shift');
    await selectLayer(page, SHAPES[2], 'Shift');
    expect(await selectionCount(app)).toBe(3);

    // The trash on one row, which is a delete aimed at that layer and nothing
    // else. The other two must keep their outlines.
    const row = page.getByTitle(`Double-click to rename "${SHAPES[2]}"`).locator('xpath=..');
    await row.getByTitle('Delete element').click();
    await page.waitForTimeout(500);

    await expect(app.elementsOn(0)).toHaveCount(2);
    expect(await selectionCount(app)).toBe(2);
  });

  test('Select all picks up every layer on the board', async ({ app, page, isDesktop }) => {
    await threeShapes(app);
    await spreadOut(page, app);
    await clickElement(page, app.elementsOn(0).nth(0));
    await page.keyboard.press(isDesktop ? 'Meta+a' : 'Control+a');
    await page.waitForTimeout(200);
    expect(await selectionCount(app)).toBe(3);
  });

  test('a marquee across empty board picks up what it touches', async ({ app, page }) => {
    await threeShapes(app);
    await placeAt(page, app, SHAPES[0], 100, 100);
    await placeAt(page, app, SHAPES[1], 100, 500);
    await placeAt(page, app, SHAPES[2], 100, 1600);

    // Deselect, then drag a band over the top two only.
    await page.keyboard.press('Escape');
    const board = app.board(0);
    const geometry = await boardGeometry(board);
    await pointerDrag(
      page,
      toPagePoint(geometry, 20, 40),
      toPagePoint(geometry, 900, 900)
    );
    await page.waitForTimeout(250);

    expect(await selectionCount(app)).toBe(2);
  });
});

test.describe('grouping', () => {
  test('grouped layers move together, and ungrouping frees them again', async ({ app, page }) => {
    await threeShapes(app);
    await placeAt(page, app, SHAPES[0], 200, 300);
    await placeAt(page, app, SHAPES[1], 700, 300);
    await placeAt(page, app, SHAPES[2], 200, 2000);

    await selectLayer(page, SHAPES[0]);
    await selectLayer(page, SHAPES[1], 'Shift');
    await app.activeDockPanel.getByTitle('Group elements (Ctrl+G)').click();
    await page.waitForTimeout(250);

    // Clicking ONE member now brings the whole group.
    await page.keyboard.press('Escape');
    await clickElement(page, app.elementsOn(0).nth(0));
    expect(await selectionCount(app)).toBe(2);

    // And an arrow key moves both by the same amount.
    const before = await Promise.all([
      elementPosition(app.elementsOn(0).nth(0)),
      elementPosition(app.elementsOn(0).nth(1)),
    ]);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    const after = await Promise.all([
      elementPosition(app.elementsOn(0).nth(0)),
      elementPosition(app.elementsOn(0).nth(1)),
    ]);
    expect(after[0].left).toBeCloseTo(before[0].left + 1, 1);
    expect(after[1].left).toBeCloseTo(before[1].left + 1, 1);

    // Ungroup, and one member is once again just one member.
    await app.activeDockPanel.getByTitle('Ungroup elements (Ctrl+Shift+G)').click();
    await page.waitForTimeout(250);
    await page.keyboard.press('Escape');
    await clickElement(page, app.elementsOn(0).nth(0));
    expect(await selectionCount(app)).toBe(0);
  });

  test('alt-click reaches one member without bringing the group', async ({ app, page }) => {
    await threeShapes(app);
    await spreadOut(page, app);
    await selectLayer(page, SHAPES[0]);
    await selectLayer(page, SHAPES[1], 'Shift');
    await app.activeDockPanel.getByTitle('Group elements (Ctrl+G)').click();
    await page.waitForTimeout(250);

    await page.keyboard.press('Escape');
    await clickElement(page, app.elementsOn(0).nth(0), 'Alt');
    // One layer, so the panel is back to the single element form.
    expect(await selectionCount(app)).toBe(0);
  });

  test('after alt-click, an arrow key moves only the member that is selected', async ({ app, page }) => {
    await threeShapes(app);
    await placeAt(page, app, SHAPES[0], 200, 300);
    await placeAt(page, app, SHAPES[1], 700, 300);
    await placeAt(page, app, SHAPES[2], 200, 2000);

    await selectLayer(page, SHAPES[0]);
    await selectLayer(page, SHAPES[1], 'Shift');
    await app.activeDockPanel.getByTitle('Group elements (Ctrl+G)').click();
    await page.waitForTimeout(300);

    // Alt-click is the way out of a group, so the arrow keys have to respect
    // it: moving the unselected member too would contradict the outline and
    // disagree with what dragging the same layer does.
    await page.keyboard.press('Escape');
    await selectLayer(page, SHAPES[0], 'Alt');
    const before = await elementPosition(app.elementsOn(0).nth(1));
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(350);

    expect((await elementPosition(app.elementsOn(0).nth(0))).left).toBeCloseTo(201, 0);
    expect((await elementPosition(app.elementsOn(0).nth(1))).left).toBeCloseTo(before.left, 0);
  });
});

test.describe('the right-click menu', () => {
  /** Right-click an element with a real pointer, and wait for the menu. */
  async function rightClick(page: Page, element: Locator): Promise<Locator> {
    const box = await element.boundingBox();
    if (!box) throw new Error('The element has no bounding box; is it on screen?');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    const menu = page.locator('[data-canvas-context-menu]');
    await menu.waitFor({ timeout: 10000 });
    return menu;
  }

  test('right-clicking inside a selection keeps it, and Group acts on all of it', async ({ app, page }) => {
    await threeShapes(app);
    await spreadOut(page, app);

    await selectLayer(page, SHAPES[0]);
    await selectLayer(page, SHAPES[1], 'Shift');
    expect(await selectionCount(app)).toBe(2);

    // Right-clicking a member must not collapse the selection to that one
    // layer, or the menu's Group would have nothing to group.
    const menu = await rightClick(page, app.elementsOn(0).nth(0));
    expect(await selectionCount(app)).toBe(2);

    await menu.getByRole('button', { name: /^Group/ }).click();
    await page.waitForTimeout(350);

    // Picking one member up now brings the other.
    await page.keyboard.press('Escape');
    await clickElement(page, app.elementsOn(0).nth(0));
    expect(await selectionCount(app)).toBe(2);
  });

  test('Ungroup is offered only once something selected is in a group', async ({ app, page }) => {
    await threeShapes(app);
    await spreadOut(page, app);

    await selectLayer(page, SHAPES[0]);
    await selectLayer(page, SHAPES[1], 'Shift');
    let menu = await rightClick(page, app.elementsOn(0).nth(0));
    await expect(menu.getByRole('button', { name: /^Ungroup/ })).toBeDisabled();
    await menu.getByRole('button', { name: /^Group/ }).click();
    await page.waitForTimeout(350);

    menu = await rightClick(page, app.elementsOn(0).nth(0));
    const ungroup = menu.getByRole('button', { name: /^Ungroup/ });
    await expect(ungroup).toBeEnabled();
    await ungroup.click();
    await page.waitForTimeout(350);

    await page.keyboard.press('Escape');
    await clickElement(page, app.elementsOn(0).nth(0));
    // One layer again, so the panel is back to the single element form.
    expect(await selectionCount(app)).toBe(0);
  });

  test('right-clicking outside the selection selects what was clicked', async ({ app, page }) => {
    await threeShapes(app);
    await spreadOut(page, app);

    await selectLayer(page, SHAPES[0]);
    await selectLayer(page, SHAPES[1], 'Shift');
    expect(await selectionCount(app)).toBe(2);

    // A third layer, which was not part of the selection.
    await rightClick(page, app.elementsOn(0).nth(2));
    expect(await selectionCount(app)).toBe(0);
  });
});

test.describe('copying a multi-selection', () => {
  test('copy and paste brings every selected layer, keeping the arrangement', async ({ app, page, isDesktop }) => {
    await threeShapes(app);
    await placeAt(page, app, SHAPES[0], 200, 300);
    await placeAt(page, app, SHAPES[1], 600, 300);
    await placeAt(page, app, SHAPES[2], 200, 2000);

    await selectLayer(page, SHAPES[0]);
    await selectLayer(page, SHAPES[1], 'Shift');

    const modifier = isDesktop ? 'Meta' : 'Control';
    await page.keyboard.press(`${modifier}+c`);
    await page.waitForTimeout(250);
    await page.keyboard.press(`${modifier}+v`);
    await page.waitForTimeout(600);

    // Both layers arrived, not just the first.
    await expect(app.elementsOn(0)).toHaveCount(5);
    // And the pair kept the 400px between them.
    const pasted = await Promise.all(
      [3, 4].map((i) => elementPosition(app.elementsOn(0).nth(i)))
    );
    expect(Math.abs(pasted[1].left - pasted[0].left)).toBeCloseTo(400, 0);
    // The paste lands selected, ready to be moved somewhere.
    expect(await selectionCount(app)).toBe(2);
  });
});

test.describe('align and distribute', () => {
  test('align to left edges puts every selected layer on the leftmost one', async ({ app, page }) => {
    await threeShapes(app);
    await placeAt(page, app, SHAPES[0], 120, 200);
    await placeAt(page, app, SHAPES[1], 400, 700);
    await placeAt(page, app, SHAPES[2], 800, 1200);

    await selectLayer(page, SHAPES[0]);
    await selectLayer(page, SHAPES[1], 'Shift');
    await selectLayer(page, SHAPES[2], 'Shift');
    await app.activeDockPanel.getByTitle('Align to left edges').click();
    await page.waitForTimeout(300);

    const lefts = await Promise.all(
      [0, 1, 2].map(async (i) => (await elementPosition(app.elementsOn(0).nth(i))).left)
    );
    // The leftmost layer is the one that does not move, so they all land on it.
    for (const left of lefts) expect(left).toBeCloseTo(120, 0);
  });

  test('align to top edges lines them up without touching x', async ({ app, page }) => {
    await threeShapes(app);
    await placeAt(page, app, SHAPES[0], 120, 900);
    await placeAt(page, app, SHAPES[1], 400, 300);
    await placeAt(page, app, SHAPES[2], 800, 1500);

    await selectLayer(page, SHAPES[0]);
    await selectLayer(page, SHAPES[1], 'Shift');
    await selectLayer(page, SHAPES[2], 'Shift');
    await app.activeDockPanel.getByTitle('Align to top edges').click();
    await page.waitForTimeout(300);

    const boxes = await Promise.all(
      [0, 1, 2].map((i) => elementPosition(app.elementsOn(0).nth(i)))
    );
    for (const box of boxes) expect(box.top).toBeCloseTo(300, 0);
    // An align on one axis leaves the other alone.
    expect(boxes[0].left).toBeCloseTo(120, 0);
    expect(boxes[1].left).toBeCloseTo(400, 0);
    expect(boxes[2].left).toBeCloseTo(800, 0);
  });

  test('distribute vertically evens out the gaps and keeps the outer two still', async ({ app, page }) => {
    await threeShapes(app);
    await placeAt(page, app, SHAPES[0], 200, 100);
    await placeAt(page, app, SHAPES[1], 200, 300);
    await placeAt(page, app, SHAPES[2], 200, 1900);

    await selectLayer(page, SHAPES[0]);
    await selectLayer(page, SHAPES[1], 'Shift');
    await selectLayer(page, SHAPES[2], 'Shift');
    await app.activeDockPanel.getByTitle('Distribute vertically').click();
    await page.waitForTimeout(300);

    const boxes = await Promise.all(
      [0, 1, 2].map((i) => elementPosition(app.elementsOn(0).nth(i)))
    );
    // The two outermost keep the extent the user gave them.
    expect(boxes[0].top).toBeCloseTo(100, 0);
    expect(boxes[2].top).toBeCloseTo(1900, 0);
    // Equal gaps, not equal centres: the space below each of the first two is
    // the same, whatever their heights are.
    const gapOne = boxes[1].top - (boxes[0].top + boxes[0].height);
    const gapTwo = boxes[2].top - (boxes[1].top + boxes[1].height);
    expect(gapOne).toBeCloseTo(gapTwo, 0);
  });

  test('distribute keeps the span when one layer sits behind the others', async ({ app, page }) => {
    await threeShapes(app);
    // A wide layer that both starts before and ends after its neighbours, which
    // is an ordinary App Store row: a headline or card behind two badges. The
    // far edge of the selection belongs to it, not to the layer that happens to
    // start last.
    await selectLayer(page, SHAPES[0]);
    await setField(page, app, '#elementWidth', 900);
    await setField(page, app, '#elementX', 100);
    await setField(page, app, '#elementY', 300);
    await placeAt(page, app, SHAPES[1], 200, 300);
    await placeAt(page, app, SHAPES[2], 400, 300);

    await selectLayer(page, SHAPES[0]);
    await selectLayer(page, SHAPES[1], 'Shift');
    await selectLayer(page, SHAPES[2], 'Shift');
    await app.activeDockPanel.getByTitle('Distribute horizontally').click();
    await page.waitForTimeout(350);

    const boxes = await Promise.all(
      [0, 1, 2].map((i) => elementPosition(app.elementsOn(0).nth(i)))
    );
    // The arrangement keeps the extent it had. Reading the far edge off the
    // wrong layer shrinks it and throws the members outside the box the user
    // selected.
    expect(Math.min(...boxes.map((b) => b.left))).toBeCloseTo(100, 0);
    expect(Math.max(...boxes.map((b) => b.left + b.width))).toBeCloseTo(1000, 0);
    // And nothing overtakes a layer it started behind.
    expect(boxes[1].left).toBeLessThanOrEqual(boxes[2].left + 1);
  });

  test('distribute is offered only once there are three layers to spread', async ({ app, page }) => {
    await threeShapes(app);
    await selectLayer(page, SHAPES[0]);
    await selectLayer(page, SHAPES[1], 'Shift');

    await expect(app.activeDockPanel.getByTitle('Distribute horizontally')).toBeDisabled();
    await selectLayer(page, SHAPES[2], 'Shift');
    await expect(app.activeDockPanel.getByTitle('Distribute horizontally')).toBeEnabled();
  });
});

test.describe('arrow key nudge', () => {
  test('an arrow moves one pixel and Shift moves ten', async ({ app, page }) => {
    await threeShapes(app);
    await placeAt(page, app, SHAPES[0], 400, 400);

    const element = app.elementsOn(0).nth(0);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(250);
    expect((await elementPosition(element)).left).toBeCloseTo(401, 1);

    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(250);
    expect((await elementPosition(element)).top).toBeCloseTo(401, 1);

    await page.keyboard.press('Shift+ArrowLeft');
    await page.waitForTimeout(250);
    expect((await elementPosition(element)).left).toBeCloseTo(391, 1);

    await page.keyboard.press('Shift+ArrowUp');
    await page.waitForTimeout(250);
    expect((await elementPosition(element)).top).toBeCloseTo(391, 1);
  });

  test('a run of nudges collapses into one undo step', async ({ app, page }) => {
    await threeShapes(app);
    await placeAt(page, app, SHAPES[0], 400, 400);
    const element = app.elementsOn(0).nth(0);

    // Clear of the history merge window first, so the nudges below are their
    // own state rather than being folded into the edit that placed the layer.
    await page.waitForTimeout(1200);

    // Back to back, well inside the window, which is the case that has to
    // collapse: a held arrow key streams presses at about this rate.
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(500);
    expect((await elementPosition(element)).left).toBeCloseTo(403, 0);

    // One undo, not three: the three moves share a merge key.
    await app.undoButton.click();
    await page.waitForTimeout(400);
    expect((await elementPosition(element)).left).toBeCloseTo(400, 0);
  });
});

test.describe('precise positioning', () => {
  test('X and Y place the layer from the top left of the artboard', async ({ app, page }) => {
    await threeShapes(app);
    await selectLayer(page, SHAPES[0]);

    await setField(page, app, '#elementX', 250);
    await setField(page, app, '#elementY', 640);

    const box = await elementPosition(app.elementsOn(0).nth(0));
    expect(box.left).toBeCloseTo(250, 1);
    expect(box.top).toBeCloseTo(640, 1);
  });

  test('W and H set the rendered size in pixels', async ({ app, page }) => {
    await threeShapes(app);
    await selectLayer(page, SHAPES[0]);

    await setField(page, app, '#elementWidth', 300);
    await setField(page, app, '#elementHeight', 180);

    const box = await elementPosition(app.elementsOn(0).nth(0));
    expect(box.width).toBeCloseTo(300, 0);
    expect(box.height).toBeCloseTo(180, 0);
  });

  test('X on a multi-selection moves the whole arrangement and keeps its shape', async ({ app, page }) => {
    await threeShapes(app);
    await placeAt(page, app, SHAPES[0], 200, 400);
    await placeAt(page, app, SHAPES[1], 500, 400);
    await placeAt(page, app, SHAPES[2], 200, 2000);

    await selectLayer(page, SHAPES[0]);
    await selectLayer(page, SHAPES[1], 'Shift');

    const field = app.activeDockPanel.locator('#selectionX');
    await field.waitFor({ timeout: 15000 });
    await field.fill('50');
    await field.press('Enter');
    await page.waitForTimeout(350);

    const boxes = await Promise.all(
      [0, 1].map((i) => elementPosition(app.elementsOn(0).nth(i)))
    );
    // The leftmost member lands on the number that was typed.
    expect(boxes[0].left).toBeCloseTo(50, 0);
    // And the gap between the two is exactly what it was.
    expect(boxes[1].left - boxes[0].left).toBeCloseTo(300, 0);
  });

  test('a negative X is kept, because a layer may hang off the board', async ({ app, page }) => {
    await threeShapes(app);
    await selectLayer(page, SHAPES[0]);
    await setField(page, app, '#elementX', -60);
    expect((await elementPosition(app.elementsOn(0).nth(0))).left).toBeCloseTo(-60, 1);
  });

  test('the size floor stops a layer being typed down to nothing', async ({ app, page }) => {
    await threeShapes(app);
    await selectLayer(page, SHAPES[0]);
    await setField(page, app, '#elementWidth', 2);
    expect((await elementPosition(app.elementsOn(0).nth(0))).width).toBeGreaterThanOrEqual(20);
  });
});

test.describe('groups in the Layers list', () => {
  /**
   * A group's own row.
   *
   * Titled differently from a layer row on purpose: the two live in the same
   * list and a shared title would make every layer locator ambiguous.
   */
  function groupRow(page: Page, name: string): Locator {
    return page.getByTitle(`Double-click to rename group "${name}"`);
  }

  test('the list groups the selection, renames the group, and frees it again', async ({ app, page }) => {
    await threeShapes(app);
    await selectLayer(page, SHAPES[0]);
    await selectLayer(page, SHAPES[1], 'Shift');

    const group = page.getByTitle('Group selected layers (Ctrl+G)');
    const ungroup = page.getByTitle('Ungroup selected layers (Ctrl+Shift+G)');
    await expect(group).toBeEnabled();
    await expect(ungroup).toBeDisabled();
    await group.click();
    await page.waitForTimeout(300);

    // The group is now the whole selection, so grouping it again would only
    // mint a second id for the same two layers.
    await expect(groupRow(page, 'Group 1')).toBeVisible();
    await expect(group).toBeDisabled();
    await expect(ungroup).toBeEnabled();
    await expect(app.activeDockPanel.getByTitle('Group elements (Ctrl+G)')).toBeDisabled();
    await expect(app.activeDockPanel.getByTitle('Ungroup elements (Ctrl+Shift+G)')).toBeEnabled();

    // Rename it from its row, the way a layer is renamed.
    await groupRow(page, 'Group 1').dblclick();
    // By its label, not its placeholder: the Properties form has a Group name
    // field of its own on screen at the same time.
    const field = page.getByLabel('Rename group');
    await field.fill('Hero row');
    await field.press('Enter');
    await expect(groupRow(page, 'Hero row')).toBeVisible();

    // The row's own Ungroup frees it whether or not it is still selected.
    await page.keyboard.press('Escape');
    await page.getByTitle('Ungroup "Hero row"').click();
    await page.waitForTimeout(300);
    await expect(groupRow(page, 'Hero row')).toHaveCount(0);
    await expect(page.getByTitle(/^Double-click to rename "/)).toHaveCount(3);
  });

  test('a collapsed group hides its members and keeps the loose layers', async ({ app, page }) => {
    await threeShapes(app);
    await selectLayer(page, SHAPES[0]);
    await selectLayer(page, SHAPES[1], 'Shift');
    await page.getByTitle('Group selected layers (Ctrl+G)').click();
    await page.waitForTimeout(300);

    await page.getByTitle('Hide what is in this group').click();
    await expect(page.getByTitle(`Double-click to rename "${SHAPES[0]}"`)).toHaveCount(0);
    // The layer that is in no group is still listed.
    await expect(page.getByTitle(`Double-click to rename "${SHAPES[2]}"`)).toBeVisible();

    await page.getByTitle('Show what is in this group').click();
    await expect(page.getByTitle(`Double-click to rename "${SHAPES[0]}"`)).toBeVisible();
  });

  /** The per-row toggle, which is how a finger builds a selection. */
  function rowToggle(page: Page, label: string, title = 'Add to the selection'): Locator {
    return page
      .getByTitle(`Double-click to rename "${label}"`)
      .locator('xpath=..')
      .getByTitle(title);
  }

  test('layers can be picked without a keyboard, and grouped', async ({ app, page }) => {
    await threeShapes(app);
    // No shift key anywhere: a finger has none, and the canvas marquee never
    // starts for touch, so these toggles are the whole path on a phone.
    // The layer that was just added is selected, and its toggle lets it go.
    await rowToggle(page, SHAPES[2], 'Take out of the selection').click();
    await rowToggle(page, SHAPES[0]).click();
    await rowToggle(page, SHAPES[1]).click();
    expect(await selectionCount(app)).toBe(2);

    const group = page.getByTitle('Group selected layers (Ctrl+G)');
    await expect(group).toBeEnabled();
    await group.click();
    await expect(groupRow(page, 'Group 1')).toBeVisible();
    await expect(page.getByTitle('2 layers in this group')).toBeVisible();
  });

  test('a layer dragged onto a group shows where it lands, and joins it', async ({ app, page }) => {
    await threeShapes(app);
    // The bottom two, so the group's row and the loose layer are the top two
    // rows of the list: an "Element Added" toast covers the rest of it, and a
    // press that lands on the toast starts no drag.
    await selectLayer(page, SHAPES[1]);
    await selectLayer(page, SHAPES[0], 'Shift');
    await page.getByTitle('Group selected layers (Ctrl+G)').click();
    await expect(groupRow(page, 'Group 1')).toBeVisible();
    await expect(page.getByTitle('2 layers in this group')).toBeVisible();

    // Dragged by hand rather than with dragTo: the hint is the point, and it
    // can only be read while the button is still down. Two moves, because the
    // first one is what starts the drag and the second is the first dragover.
    const from = await page.getByTitle(`Double-click to rename "${SHAPES[2]}"`).boundingBox();
    const onto = await groupRow(page, 'Group 1').boundingBox();
    if (!from || !onto) throw new Error('a layer row is off screen');
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(onto.x + onto.width / 2, onto.y + onto.height / 2, { steps: 12 });
    await page.mouse.move(onto.x + onto.width / 2, onto.y + onto.height / 2 + 2, { steps: 4 });

    await expect(page.locator('[data-drop-indicator]')).toBeVisible();
    await expect(page.locator('[data-drop-into]')).toHaveCount(1);

    await page.mouse.up();
    await page.waitForTimeout(400);
    await expect(page.getByTitle('3 layers in this group')).toBeVisible();
    await expect(page.locator('[data-drop-indicator]')).toHaveCount(0);
  });
});
