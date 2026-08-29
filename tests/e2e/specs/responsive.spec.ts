import { test, expect } from '../fixtures/test';
import { canvasBottomBarsOverlap } from '../helpers/canvas';

/**
 * The two floating bars along the bottom of the canvas.
 *
 * One holds the selection tool, the pan tool and undo/redo, and is centred on
 * the canvas. The other holds the zoom control and is pinned to the bottom
 * right. They are positioned independently, so whether they collide comes down
 * to how wide the canvas is, and the app already knows this: the tool bar
 * carries `max-md:left-3 max-md:translate-x-0` under a comment saying it is
 * "pushed to the left edge on a phone so it and the zoom pill share the bottom
 * row instead of sitting on top of each other".
 *
 * The escape hatch is real. Its breakpoint is not: `md` is 768px, and the two
 * bars start overlapping just under 1280px. Measured, at a blank project with
 * the palette and the dock both open:
 *
 *   1600px  tools 699..870   zoom 1029..1264   clear
 *   1440px  tools 619..790   zoom  869..1104   clear
 *   1280px  tools 539..710   zoom  709..944    touching
 *   1180px  tools 489..660   zoom  609..844    overlapping by 51px
 *   1080px  tools 439..610   zoom  509..744    overlapping by 101px, and the
 *                                              Undo button itself is buried
 *
 * At the last of those, a tablet in landscape, Undo cannot be tapped at all:
 * Playwright reports the Zoom Out button intercepting the pointer.
 */

/** Widths where the layout is known to be correct. */
const ROOMY = [
  { label: 'wide desktop', width: 1600, height: 1000 },
  { label: 'desktop', width: 1440, height: 900 },
];

/**
 * Widths where the bars collide today: wider than the `md` escape hatch, and
 * narrower than the room the centred bar actually needs. A tablet in landscape
 * and a small laptop both live in here.
 */
const CRAMPED = [
  { label: 'small laptop', width: 1180, height: 820 },
  { label: 'tablet landscape', width: 1080, height: 810 },
];
// 1280px is left out of both lists on purpose: the two bars are exactly
// touching there, and a test that hangs on a single pixel is a test that will
// start flaking the next time a padding changes.

test.describe('the canvas bottom bars', () => {
  test('keep out of each other at desktop widths', async ({ app, page }) => {
    await app.startBlankProject();

    for (const size of ROOMY) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await expect(app.undoButton).toBeVisible();
      expect(
        await canvasBottomBarsOverlap(page),
        `the tool bar and the zoom pill overlap at ${size.label}, ${size.width}px`
      ).toBe(false);
    }
  });

  test('keep out of each other at tablet and small laptop widths too', async ({ app, page }) => {
    // Expected to fail: this documents a defect that is still in the app, and
    // it reports loudly the moment somebody fixes it. The fix is a breakpoint,
    // not a layout: the tool bar's `max-md:` escape hatch needs to fire at the
    // width where the collision actually starts, around `lg` or `xl`.
    // Declared inside the test on purpose. At describe level it would leak on
    // to every test after it.
    test.fail();

    await app.startBlankProject();

    for (const size of CRAMPED) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await expect(app.undoButton).toBeVisible();
      expect(
        await canvasBottomBarsOverlap(page),
        `the tool bar and the zoom pill overlap at ${size.label}, ${size.width}px`
      ).toBe(false);
    }
  });

  test('Undo is reachable by a real click wherever the bars are laid out', async ({ app, page }) => {
    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await app.addElementFrom('Basic', 'Text', 'basic:text');
    await expect(app.elementsOn(0)).toHaveCount(1);

    // Skipped rather than failed on the widths above: the overlap is already
    // covered by its own test, and a second red mark for the same defect only
    // makes the report harder to read.
    test.skip(
      await canvasBottomBarsOverlap(page),
      'the zoom pill covers Undo at this width, which the overlap test above owns'
    );

    await app.undoButton.click();
    await expect(app.elementsOn(0)).toHaveCount(0);
  });
});
