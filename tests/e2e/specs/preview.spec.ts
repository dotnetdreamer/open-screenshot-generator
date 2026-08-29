import { test, expect } from '../fixtures/test';
import { waitForProject } from '../fixtures/db';
import type { Locator } from '@playwright/test';
import type { Editor } from '../helpers/editor';

/**
 * The preview surfaces.
 *
 * AGENTS.md rule 2 is the reason this file exists: an element is rendered in
 * TWO places, Artboard.tsx on the canvas and StaticArtboard (shared by the
 * preview dialog, the language proof sheet and the store listing mockup).
 * Miss one and the element is simply absent from everything the user checks
 * their work in, while the canvas still looks right. So every assertion here
 * is "the thing on the canvas is also in the preview", never "the dialog
 * opened".
 *
 * Both copies are in the document at once, and StaticArtboard deliberately
 * does NOT carry `data-element-id` (that belongs to DraggableElement on the
 * canvas). Every locator below is therefore rooted at either the board or the
 * dialog, and the counts are asserted on both sides so a locator that
 * accidentally spanned the two would fail rather than pass twice over.
 */

/** Text boxes, in whichever render site `root` is. */
const textBodies = (root: Locator): Locator => root.locator('[data-text-body="true"]');

/** ShapeElement paints its fill on the innermost box, in both render sites. */
const shapeFills = (root: Locator): Locator => root.locator('div.bg-transparent > div');

/** The StaticArtboard surfaces inside the preview: the stage, and each thumb. */
const previewSurfaces = (dialog: Locator): Locator => dialog.locator('[data-artboard-surface]');

/**
 * One wrapper div per element, in board pixels. StaticArtboard emits the
 * wrapper unconditionally and only the INNER renderer is behind a type switch,
 * so an element type that was never added to StaticArtboard shows up as an
 * empty wrapper rather than a missing one. That is the exact shape of a rule 2
 * regression, which is why this counts childless wrappers instead of wrappers.
 */
async function unrenderedElements(surface: Locator): Promise<number> {
  return surface
    .locator('> div')
    .evaluateAll((nodes) => nodes.filter((node) => node.children.length === 0).length);
}

/** The inline box a render site put an element at, in artboard pixels. */
function inlineBox(node: Locator): Promise<string[]> {
  return node.evaluate((el) => {
    const s = (el as HTMLElement).style;
    return [s.left, s.top, s.width, s.height];
  });
}

/** A blank project with the palette open, which is where every test starts. */
async function blankWithPalette(app: Editor): Promise<void> {
  await app.startBlankProject();
  await app.ensurePaletteOpen();
}

/**
 * Give the selected text element distinctive copy.
 *
 * PropertiesPanel holds a text-content edit in local state and commits it to
 * the artboard on BLUR, not on change (handleTextContentBlur), so a fill on
 * its own leaves the box saying one thing and the board saying another. The
 * explicit blur is the commit, and is what a user typing and clicking away
 * does. Waiting for the seeded value first stops the fill racing the effect
 * that loads the newly selected element into the panel.
 */
async function setTextContent(app: Editor, value: string): Promise<void> {
  await expect(app.textContentInput).not.toHaveValue('');
  await app.textContentInput.fill(value);
  await app.textContentInput.blur();
  await expect(textBodies(app.board(0)).first()).toHaveText(value);
}

test.describe('full screen preview', () => {
  test('renders the same text the canvas does, at the same size', async ({ app, page }) => {
    const marker = 'PREVIEW PARITY 8213';
    await blankWithPalette(app);
    await app.addElementFrom('Basic', 'Text', 'basic:text');
    await setTextContent(app, marker);

    // Rule 3: text renders at fontSize / 0.3 and ignores element.scale. The
    // preview has to agree, or what the user proofs is not what exports.
    const canvasFontSize = await textBodies(app.board(0)).first().evaluate(
      (el) => getComputedStyle(el).fontSize
    );
    expect(canvasFontSize).not.toBe('16px');

    await app.openPreview();
    const dialog = app.previewDialog;

    // The stage and the single filmstrip thumb are both StaticArtboards, so a
    // one-board project paints the text twice INSIDE the dialog and once on
    // the canvas behind it. Asserting both numbers is what proves the two
    // locators are really scoped to different roots.
    await expect(previewSurfaces(dialog)).toHaveCount(2);
    await expect(textBodies(dialog)).toHaveCount(2);
    await expect(textBodies(app.board(0))).toHaveCount(1);
    await expect(textBodies(dialog).first()).toHaveText(marker);
    await expect(textBodies(dialog).last()).toHaveText(marker);
    await expect(textBodies(dialog).first()).toHaveCSS('font-size', canvasFontSize);

    // The header names the board the editor had selected, at export size.
    await expect(dialog.getByText('Blank Artboard', { exact: true })).toBeVisible();
    await expect(dialog.getByText('1290 × 2796px')).toBeVisible();
    await expect(dialog.getByText('1 / 1')).toBeVisible();
    expect(await page.locator('[role="dialog"] [data-element-id]').count()).toBe(0);
  });

  test('renders a shape at the same fill and the same box as the canvas', async ({ app }) => {
    await blankWithPalette(app);
    await app.addElementFrom('Basic', 'Rectangle', 'basic:rectangle');
    await expect(shapeFills(app.board(0))).toHaveCount(1);

    const canvasFill = await shapeFills(app.board(0)).first().evaluate(
      (el) => getComputedStyle(el).backgroundColor
    );
    // A shape that lost its renderer would read as fully transparent here, so
    // the comparison below would pass against nothing without this.
    expect(canvasFill).not.toBe('rgba(0, 0, 0, 0)');
    const canvasBox = await inlineBox(app.elementsOn(0).first());

    await app.openPreview();
    const dialog = app.previewDialog;

    await expect(shapeFills(dialog)).toHaveCount(2);
    await expect(shapeFills(app.board(0))).toHaveCount(1);
    await expect(shapeFills(dialog).first()).toHaveCSS('background-color', canvasFill);

    // StaticArtboard positions in artboard pixels and scales the whole surface
    // with a transform, exactly as the canvas does. Same numbers, or the
    // preview is lying about the layout.
    const stage = previewSurfaces(dialog).first();
    expect(await inlineBox(stage.locator('> div').first())).toEqual(canvasBox);
    expect(await unrenderedElements(stage)).toBe(0);
  });

  test('renders every element type on the board, not just the ones it knows', async ({ app, page }) => {
    // Three different renderer branches in one board: text, shape and gesture.
    // Dropping any one of them from StaticArtboard leaves its wrapper empty.
    await blankWithPalette(app);
    await app.addElementFrom('Basic', 'Text', 'basic:text');
    await app.addElement('Circle', 'basic:circle');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await app.addElementFrom('App Preview', 'Tap', 'preview:tap');
    await expect(app.elementsOn(0)).toHaveCount(3);

    await app.openPreview();
    const stage = previewSurfaces(app.previewDialog).first();
    await expect(stage.locator('> div')).toHaveCount(3);
    expect(await unrenderedElements(stage)).toBe(0);
  });

  test('closes from its own button and from Escape, leaving the editor alive', async ({ app, page }) => {
    await blankWithPalette(app);
    await app.addElementFrom('Basic', 'Text', 'basic:text');

    await app.openPreview();
    await app.previewDialog.getByTitle('Close preview (Esc)').click();
    await expect(app.previewDialog).toBeHidden();

    await app.openPreview();
    await page.keyboard.press('Escape');
    await expect(app.previewDialog).toBeHidden();

    // The Escape handler runs in the capture phase so editor shortcuts cannot
    // fire underneath it: the element it was previewing is still there.
    await expect(app.elementsOn(0)).toHaveCount(1);
    await expect(app.board(0)).toBeVisible();
  });
});

test.describe('store listing preview', () => {
  test('opens straight into the mockup and puts the real board on the phone', async ({ app }) => {
    const marker = 'STORE PARITY 4471';
    await blankWithPalette(app);
    await app.addElementFrom('Basic', 'Text', 'basic:text');
    await setTextContent(app, marker);

    await app.chooseFromMenu(app.previewButton, /Store listing/i);
    const dialog = app.previewDialog;
    await expect(dialog).toBeVisible();

    // The store mockup replaces the stage and the filmstrip, so the board is
    // painted exactly once here, inside the phone.
    await expect(dialog.getByText('Store listing', { exact: true })).toBeVisible();
    await expect(dialog.getByText('1 screenshot')).toBeVisible();
    await expect(dialog.locator('[data-shot-index]')).toHaveCount(1);
    await expect(textBodies(dialog)).toHaveCount(1);
    await expect(textBodies(dialog).first()).toHaveText(marker);
    await expect(dialog.getByText(/iPhone 16 Pro, 393 × 852pt/)).toBeVisible();

    // Switching store rebuilds the frame at Play's size and rebinds the
    // intersection observer that decides which shots are live. The board has
    // to survive that, which is the half of this view that can silently break.
    await dialog.getByRole('button', { name: 'Google Play', exact: true }).click();
    await expect(dialog.getByText(/Pixel 9, 412 × 915pt/)).toBeVisible();
    await expect(textBodies(dialog).first()).toHaveText(marker);
    await expect(dialog.locator('[data-shot-index]')).toHaveCount(1);
  });

  test('toggles with the full screen view without closing the dialog', async ({ app }) => {
    await blankWithPalette(app);
    await app.addElementFrom('Basic', 'Rectangle', 'basic:rectangle');
    await app.openPreview();
    const dialog = app.previewDialog;
    await expect(dialog.getByText('1 / 1')).toBeVisible();
    await expect(dialog.locator('[data-shot-index]')).toHaveCount(0);

    await dialog.getByRole('button', { name: 'Store preview', exact: true }).click();
    await expect(dialog.getByText('Store listing', { exact: true })).toBeVisible();
    await expect(dialog.locator('[data-shot-index]')).toHaveCount(1);
    await expect(shapeFills(dialog)).toHaveCount(1);

    await dialog.getByRole('button', { name: 'Back to preview', exact: true }).click();
    await expect(dialog.getByText('1 / 1')).toBeVisible();
    await expect(dialog.locator('[data-shot-index]')).toHaveCount(0);
    // Stage plus filmstrip again, both drawing the rectangle.
    await expect(previewSurfaces(dialog)).toHaveCount(2);
    await expect(shapeFills(dialog)).toHaveCount(2);
  });
});

test.describe('preview timeline bar', () => {
  test("appears only once the board has motion, and its length is the project's", async ({ app, page }) => {
    await blankWithPalette(app);
    // A still board has nothing to play, so the bar stays out of the way.
    await expect(page.getByTitle('Play preview')).toHaveCount(0);

    // A gesture hint is motion with no video file behind it, which is the only
    // way to reach this bar without a real recording to import.
    await app.addElementFrom('App Preview', 'Tap', 'preview:tap');
    await expect(page.getByTitle('Play preview')).toBeVisible();
    await expect(page.getByTitle('Restart')).toBeVisible();

    const length = page.locator('input[title="Length of this preview, in seconds"]');
    await expect(length).toHaveValue('15');

    await page.getByTitle('One second longer').click();
    await expect(length).toHaveValue('16');
    // The length is a property of the artboard, so it has to reach Dexie
    // through handleArtboardsUpdate rather than living in the bar's own state.
    await waitForProject(
      page,
      (project) =>
        Array.isArray(project.projectData) &&
        (project.projectData as { previewDurationSeconds?: number }[])[0]?.previewDurationSeconds === 16
    );

    await page.getByTitle('One second shorter').click();
    await expect(length).toHaveValue('15');

    await page.getByTitle('Collapse timeline').click();
    await expect(page.getByTitle('Expand timeline')).toBeVisible();
    await expect(page.getByTitle('Collapse timeline')).toHaveCount(0);
  });
});
