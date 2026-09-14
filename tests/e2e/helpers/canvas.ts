import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Canvas geometry and pointer gestures.
 *
 * Two things make the canvas awkward to drive and both are deliberate in the
 * app:
 *
 *  1. A board is laid out at its FULL store resolution (1290x2796 for an
 *     iPhone 6.9") and shrunk by a CSS transform. A transform contributes
 *     nothing to layout, so an element's `style.left` is in artboard pixels
 *     while its bounding rect is in screen pixels. Anything a test wants to
 *     click has to be converted, and the conversion factor is the board's own
 *     rect over its `data-original-width`, NOT the `data-display-scale`
 *     attribute, because canvas zoom multiplies the former and leaves the
 *     latter alone.
 *
 *  2. Every canvas interaction is a POINTER event: a finger fires no
 *     `mousedown`, so the app never listens for one. Playwright's mouse API
 *     does dispatch pointer events, but a drag has to be a real
 *     move -> down -> move -> move -> up sequence. One `dragTo` is not enough:
 *     the app needs intermediate moves to see a gesture rather than a jump.
 */

export interface BoardGeometry {
  /** Board rect in page coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** The board's authored size, e.g. 1290 x 2796. */
  originalWidth: number;
  originalHeight: number;
  /** Screen pixels per artboard pixel, zoom included. */
  scale: number;
}

export async function boardGeometry(board: Locator): Promise<BoardGeometry> {
  const box = await board.boundingBox();
  if (!box) throw new Error('The artboard has no bounding box; is it on screen?');
  const originalWidth = Number(await board.getAttribute('data-original-width'));
  const originalHeight = Number(await board.getAttribute('data-original-height'));
  if (!originalWidth || !originalHeight) {
    throw new Error('The artboard is missing data-original-width/height');
  }
  return {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    originalWidth,
    originalHeight,
    scale: box.width / originalWidth,
  };
}

/** Convert a point in artboard pixels to a point on the page. */
export function toPagePoint(
  geometry: BoardGeometry,
  artboardX: number,
  artboardY: number
): { x: number; y: number } {
  return {
    x: geometry.x + artboardX * geometry.scale,
    y: geometry.y + artboardY * geometry.scale,
  };
}

/** An element's authored position, read off the inline style the app writes. */
export async function elementPosition(element: Locator): Promise<{ left: number; top: number; width: number; height: number }> {
  return element.evaluate((el) => {
    const style = (el as HTMLElement).style;
    const num = (v: string) => Number.parseFloat(v.replace('px', '')) || 0;
    return {
      left: num(style.left),
      top: num(style.top),
      width: num(style.width),
      height: num(style.height),
    };
  });
}

/**
 * Drag with a real pointer gesture.
 *
 * `steps` matters: the app distinguishes a click from a drag by movement
 * between pointerdown and pointerup, and some handlers only arm after the
 * first pointermove.
 */
export async function pointerDrag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 12
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // One small move first, so a handler that arms on the first pointermove has
  // seen one before the big travel starts.
  await page.mouse.move(from.x + 2, from.y + 2);
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}

/** Drag an element by a delta measured in ARTBOARD pixels. */
export async function dragElementBy(
  page: Page,
  board: Locator,
  element: Locator,
  deltaArtboardX: number,
  deltaArtboardY: number
): Promise<void> {
  const geometry = await boardGeometry(board);
  const box = await element.boundingBox();
  if (!box) throw new Error('The element has no bounding box');
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const to = {
    x: from.x + deltaArtboardX * geometry.scale,
    y: from.y + deltaArtboardY * geometry.scale,
  };
  await pointerDrag(page, from, to);
}

/**
 * A mouse WHEEL, which the canvas treats as zoom, as opposed to a trackpad's
 * two-finger scroll. CanvasArea tells them apart by `deltaMode` and the legacy
 * `wheelDeltaY` ratio, so a synthetic wheel has to look like the real thing.
 */
export async function mouseWheelZoom(page: Page, target: Locator, deltaY: number): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error('The zoom target has no bounding box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await target.evaluate((el, dy) => {
    const rect = el.getBoundingClientRect();
    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      clientX: rect.x + rect.width / 2,
      clientY: rect.y + rect.height / 2,
      deltaY: dy,
      // DOM_DELTA_LINE. A trackpad reports DOM_DELTA_PIXEL, and that is the
      // difference the app keys off.
      deltaMode: 1,
    });
    el.dispatchEvent(event);
  }, deltaY);
}

/** Assert a board is showing the size it claims to be authored at. */
export async function expectBoardSize(board: Locator, width: number, height: number): Promise<void> {
  await expect(board).toHaveAttribute('data-original-width', String(width));
  await expect(board).toHaveAttribute('data-original-height', String(height));
}

/** The two floating bars along the bottom of the canvas, in page coordinates. */
export async function bottomBarBoxes(page: Page): Promise<{
  tools: { x: number; y: number; width: number; height: number } | null;
  zoom: { x: number; y: number; width: number; height: number } | null;
}> {
  return page.evaluate(() => {
    const box = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    // The selection/undo/zoom group, centred on the canvas, and the zoom pill
    // pinned to the bottom right. Located by their positioning classes because
    // neither container carries a name of its own.
    return {
      tools: box(document.querySelector('div.absolute.bottom-4.left-1\\/2')),
      zoom: box(document.querySelector('div.absolute.bottom-4.right-4')),
    };
  });
}

/**
 * True when the canvas tool bar and the zoom pill are on top of each other.
 *
 * They are laid out independently, one centred and one pinned right, so
 * whether they collide is purely a function of how wide the canvas is.
 */
export async function canvasBottomBarsOverlap(page: Page): Promise<boolean> {
  const { tools, zoom } = await bottomBarBoxes(page);
  if (!tools || !zoom) return false;
  return !(
    tools.x + tools.width <= zoom.x ||
    zoom.x + zoom.width <= tools.x ||
    tools.y + tools.height <= zoom.y ||
    zoom.y + zoom.height <= tools.y
  );
}
