import { test, expect } from '../fixtures/test';
import type { Locator, Page } from '@playwright/test';
import { boardGeometry, dragElementBy, elementPosition, mouseWheelZoom, expectBoardSize, canvasBottomBarsOverlap } from '../helpers/canvas';
import { waitForProject } from '../fixtures/db';

/**
 * The canvas: zoom, the wheel, pointer drags, the hand tool, and the size of
 * the boards themselves.
 *
 * Everything here is measured off the real DOM rather than off React state,
 * because the canvas is where the two most easily disagree: zoom is a CSS
 * transform on the board layer, a board's authored size is a data attribute,
 * and an element's position is an inline style in artboard pixels.
 */

/** What Dexie holds for a project, narrowed to the canvas fields. */
interface StoredBoard {
  size: { width: number; height: number };
  elements: { id: string; position: { x: number; y: number } }[];
}

/**
 * The canvas scroll viewport, which is what the hand tool actually moves.
 *
 * Scoped by the content div's own marker instead of taken by index: the app
 * has other Radix scroll areas, and which one comes first depends on whichever
 * panels happen to be open.
 */
function canvasViewport(page: Page): Locator {
  return page.locator('[data-radix-scroll-area-viewport]:has([data-canvas-locale])');
}

function scrollOffset(page: Page): Promise<{ left: number; top: number }> {
  return canvasViewport(page).evaluate((el) => ({ left: el.scrollLeft, top: el.scrollTop }));
}

/**
 * A trackpad's two-finger scroll, the counterpart to `mouseWheelZoom`.
 *
 * The app has to tell one from the other because they want opposite things out
 * of the same event, and the browser does not say which device it was
 * (CanvasArea's isMouseWheel). The tells, both of which this reproduces:
 * `deltaMode` is pixels, and the legacy `wheelDeltaY` is exactly -3x `deltaY`.
 * A constructed WheelEvent defaults `wheelDeltaY` to `-deltaY`, which reads as
 * a mouse, so the legacy field has to be set explicitly for this to be the
 * gesture it claims to be.
 */
async function trackpadWheelScroll(
  page: Page,
  target: Locator,
  deltaY: number,
  options: { ctrlKey?: boolean } = {}
): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error('The wheel target has no bounding box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await target.evaluate(
    (el, { dy, ctrlKey }) => {
      const rect = el.getBoundingClientRect();
      const init: WheelEventInit = {
        bubbles: true,
        cancelable: true,
        clientX: rect.x + rect.width / 2,
        clientY: rect.y + rect.height / 2,
        deltaY: dy,
        deltaMode: 0,
        ctrlKey,
      };
      // Not in lib.dom's WheelEventInit, but both engines honour it.
      (init as WheelEventInit & { wheelDeltaY: number }).wheelDeltaY = -3 * dy;
      el.dispatchEvent(new WheelEvent('wheel', init));
    },
    { dy: deltaY, ctrlKey: options.ctrlKey ?? false }
  );
}

/** A mouse wheel with Ctrl held, which zooms whatever the preference says. */
async function ctrlMouseWheelZoom(page: Page, target: Locator, deltaLines: number): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error('The wheel target has no bounding box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await target.evaluate(
    (el, dy) => {
      const rect = el.getBoundingClientRect();
      el.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          clientX: rect.x + rect.width / 2,
          clientY: rect.y + rect.height / 2,
          deltaY: dy,
          deltaMode: 1,
          ctrlKey: true,
        })
      );
    },
    deltaLines
  );
}

/** Screen pixels wobble by sub-pixel amounts; artboard pixels by a mouse step. */
function expectClose(actual: number, expected: number, tolerance: number): void {
  expect(
    Math.abs(actual - expected),
    `expected ${actual} to be within ${tolerance} of ${expected}`
  ).toBeLessThanOrEqual(tolerance);
}

/**
 * Six lines of wheel is 96px to the app (deltaY x 16), and exp(96 x 0.0022) is
 * 1.2352, so one gesture of this size lands on exactly 124%. Asserting the
 * number rather than "it grew" is what would catch a change to the
 * sensitivity constant.
 */
const WHEEL_LINES = -6;
const WHEEL_ZOOM_LABEL = '124%';
const WHEEL_ZOOM_FACTOR = 1.2352;

test.describe('canvas zoom', () => {
  test('the zoom pill scales the board and reset puts the geometry back', async ({ app }) => {
    await app.startBlankProject();
    const board = app.board(0);
    const start = await boardGeometry(board);

    await app.zoomInButton.click();
    await expect(app.zoomResetButton).toHaveText('120%');
    const zoomedIn = await boardGeometry(board);
    expectClose(zoomedIn.width, start.width * 1.2, 1);
    // Zoom is a transform on the board layer, so the board is still authored at
    // 1290x2796 and only the screen pixels per artboard pixel moved.
    await expectBoardSize(board, 1290, 2796);
    expectClose(zoomedIn.scale, start.scale * 1.2, 0.01);

    await app.zoomOutButton.click();
    await expect(app.zoomResetButton).toHaveText('100%');
    expectClose((await boardGeometry(board)).width, start.width, 1);

    await app.zoomInButton.click();
    await app.zoomInButton.click();
    await expect(app.zoomResetButton).toHaveText('144%');
    expectClose((await boardGeometry(board)).width, start.width * 1.44, 1);

    await app.zoomResetButton.click();
    await expect(app.zoomResetButton).toHaveText('100%');
    const reset = await boardGeometry(board);
    expectClose(reset.width, start.width, 1);
    expectClose(reset.height, start.height, 1);
  });

  test('a mouse wheel zooms the canvas and a two-finger scroll does not', async ({ app, page }) => {
    await app.startBlankProject();
    const board = app.board(0);
    const start = await boardGeometry(board);

    // The trackpad gesture goes first, so the mouse wheel that follows is the
    // proof that the canvas was listening the whole time: if the two were
    // treated alike, this would be a zoom already.
    await trackpadWheelScroll(page, board, WHEEL_LINES * 16);
    await expect(app.zoomResetButton).toHaveText('100%');
    expectClose((await boardGeometry(board)).width, start.width, 1);

    await mouseWheelZoom(page, board, WHEEL_LINES);
    await expect(app.zoomResetButton).toHaveText(WHEEL_ZOOM_LABEL);
    expectClose((await boardGeometry(board)).width, start.width * WHEEL_ZOOM_FACTOR, 1);

    // Ctrl belongs to the browser's own page zoom, so the canvas has to answer
    // it whatever the gesture was: a trackpad pinch arrives exactly like this.
    await app.zoomResetButton.click();
    await expect(app.zoomResetButton).toHaveText('100%');
    await trackpadWheelScroll(page, board, WHEEL_LINES * 16, { ctrlKey: true });
    await expect(app.zoomResetButton).toHaveText(WHEEL_ZOOM_LABEL);
  });

  test('the wheel-zoom preference gates the wheel but never Ctrl', async ({ app, page }) => {
    await app.startBlankProject();
    const board = app.board(0);

    await app.openSettings();
    const wheelZoom = page.locator('#settings-wheel-zoom');
    await expect(wheelZoom).toHaveAttribute('aria-checked', 'true');
    await wheelZoom.click();
    await expect(wheelZoom).toHaveAttribute('aria-checked', 'false');
    await app.closeDialog();
    await expect(app.settingsDialog).toBeHidden();

    // The preference is shared through a cache rather than read from storage on
    // every event, so the already mounted canvas must see this without a reload.
    expect(await page.evaluate(() => localStorage.getItem('open-screenshot-generator.wheel-zoom'))).toBe('0');
    await mouseWheelZoom(page, board, WHEEL_LINES);
    await expect(app.zoomResetButton).toHaveText('100%');

    await ctrlMouseWheelZoom(page, board, WHEEL_LINES);
    await expect(app.zoomResetButton).toHaveText(WHEEL_ZOOM_LABEL);

    await app.zoomResetButton.click();
    await app.openSettings();
    await wheelZoom.click();
    await expect(wheelZoom).toHaveAttribute('aria-checked', 'true');
    await app.closeDialog();
    await expect(app.settingsDialog).toBeHidden();
    await mouseWheelZoom(page, board, WHEEL_LINES);
    await expect(app.zoomResetButton).toHaveText(WHEEL_ZOOM_LABEL);
  });
});

test.describe('canvas gestures', () => {
  test('a pointer drag moves the element it started on, and the move persists', async ({ app, page }) => {
    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await app.addElementFrom('Basic', 'Rectangle', 'basic:rectangle');

    const element = app.elementsOn(0).last();
    const elementId = await element.getAttribute('data-element-id');
    expect(elementId).toBeTruthy();

    // The first press only selects: an unselected element is not a drag
    // surface, which is what stops a stray click from nudging artwork.
    await element.click();
    await expect(element.locator('[data-interaction-handle="true"]').first()).toBeVisible();

    const before = await elementPosition(element);
    await dragElementBy(page, app.board(0), element, 200, -300);

    const after = await elementPosition(element);
    // Screen pixels are 0.3 of an artboard pixel at 100% zoom, so one pixel of
    // mouse rounding is worth three here.
    expectClose(after.left - before.left, 200, 12);
    expectClose(after.top - before.top, -300, 12);
    expectClose(after.width, before.width, 0.5);

    const stored = await waitForProject(page, (project) => {
      const boards = project.projectData as StoredBoard[];
      const moved = boards?.[0]?.elements?.find((el) => el.id === elementId);
      return !!moved && Math.abs(moved.position.x - (before.left + 200)) <= 12;
    });
    const persisted = (stored.projectData as StoredBoard[])[0].elements.find((el) => el.id === elementId);
    expectClose(persisted!.position.y, before.top - 300, 12);
  });

  test('the pan tool scrolls the canvas instead of moving an element', async ({ app, page }) => {
    await app.startBlankProject();
    await app.ensurePaletteOpen();
    // The canvas tool bar and the zoom pill overlap below about 1280px, which
    // leaves these controls covered. responsive.spec.ts owns that defect; a
    // second red mark for it here would only make the report harder to read.
    test.skip(
      await canvasBottomBarsOverlap(page),
      'the zoom pill covers the canvas tool bar at this width, see responsive.spec.ts'
    );
    await app.addElementFrom('Basic', 'Rectangle', 'basic:rectangle');
    const element = app.elementsOn(0).last();
    // Selected on purpose: a selected element IS a drag surface under the
    // selection tool, so this is the case where the hand tool has to win.
    await element.click();
    await expect(element.locator('[data-interaction-handle="true"]').first()).toBeVisible();

    // A board at 100% is barely taller than the viewport, so zoom in for room
    // to pan into.
    for (let i = 0; i < 3; i++) await app.zoomInButton.click();
    await expect(app.zoomResetButton).toHaveText('173%');

    await app.panTool.click();
    const viewport = canvasViewport(page);
    const box = await viewport.boundingBox();
    if (!box) throw new Error('The canvas viewport has no bounding box');
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

    // Drag the canvas down first, so the scroll offset is parked against its
    // top and the pan that follows has the whole range in front of it.
    await pan(page, centre, 0, 320);
    const parked = await scrollOffset(page);
    const before = await elementPosition(element);

    await pan(page, centre, 0, -200);
    const panned = await scrollOffset(page);
    expectClose(panned.top - parked.top, 200, 12);

    // The element under the hand never moved, in the DOM or in the database.
    expect(await elementPosition(element)).toEqual(before);

    // Back to the selection tool, and the same gesture moves artwork again.
    await app.selectionTool.click();
    await dragElementBy(page, app.board(0), element, 0, -100);
    expectClose((await elementPosition(element)).top - before.top, -100, 12);
  });
});

test.describe('canvas layout', () => {
  test('a second artboard lands beside the first without overlapping it', async ({ app, page }) => {
    await app.startBlankProject();
    await expect(app.artboards).toHaveCount(1);

    // The board's own toolbar is icon-only with no title and no aria-label, so
    // the tooltip is the only thing that names the button. Hovering first both
    // reveals it and proves this is the button the test means.
    const addArtboard = boardToolbar(page, 0).getByRole('button').first();
    await addArtboard.hover();
    await expect(page.getByRole('tooltip', { name: 'Add New Artboard After' })).toBeVisible();
    await addArtboard.click();

    await expect(app.artboards).toHaveCount(2);
    await expectBoardSize(app.board(1), 1290, 2796);

    const first = await boardGeometry(app.board(0));
    const second = await boardGeometry(app.board(1));
    // Boards are laid out left to right by the parent, which rewrites every
    // position on every update, so a new one can never sit on top of another.
    expect(first.x + first.width).toBeLessThanOrEqual(second.x + 1);
    expectClose(second.y, first.y, 2);

    await waitForProject(page, (project) => (project.projectData as StoredBoard[])?.length === 2);
  });

  test('the canvas size dialog resizes every board and retitles the toolbar', async ({ app, page }) => {
    await app.startBlankProject();
    const addArtboard = boardToolbar(page, 0).getByRole('button').first();
    await addArtboard.click();
    await expect(app.artboards).toHaveCount(2);

    await app.canvasSizeButton.click();
    await expect(app.canvasSizeDialog).toBeVisible();
    await app.canvasSizeDialog
      .getByRole('radio', { name: /iPad 13" \(Portrait\).*2064 by 2752/ })
      .click();
    await app.canvasSizeDialog.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(app.canvasSizeDialog).toBeHidden();

    // Every board, not just the selected one: the canvas size is a property of
    // the project, and a store listing of mismatched screenshots is rejected.
    await expectBoardSize(app.board(0), 2064, 2752);
    await expectBoardSize(app.board(1), 2064, 2752);
    await expect(app.canvasSizeButton).toHaveAttribute('title', /2064 × 2752 · iPad 13" \(Portrait\)/);

    const wide = await boardGeometry(app.board(0));
    const tall = await boardGeometry(app.board(1));
    // 3:4 now, where the iPhone board was 9:19.5.
    expectClose(wide.width / wide.height, 2064 / 2752, 0.02);
    expect(wide.x + wide.width).toBeLessThanOrEqual(tall.x + 1);

    await waitForProject(page, (project) => {
      const boards = project.projectData as StoredBoard[];
      return boards?.length === 2 && boards.every((b) => b.size.width === 2064 && b.size.height === 2752);
    });
  });
});

/**
 * The floating toolbar above one board. One is rendered per board, inside that
 * board's own wrapper, so DOM order is board order.
 */
function boardToolbar(page: Page, index: number): Locator {
  return page.locator('div.absolute.-top-9').nth(index);
}

/** A hand-tool drag: the same pointer sequence a real grab produces. */
async function pan(page: Page, from: { x: number; y: number }, dx: number, dy: number): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 2, from.y + 2);
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 12 });
  await page.mouse.up();
}
