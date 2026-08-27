import type { Locator } from '@playwright/test';
import { test, expect } from '../fixtures/test';
import { elementPosition } from '../helpers/canvas';
import { waitForProject } from '../fixtures/db';
import type { Editor } from '../helpers/editor';

/**
 * The Properties panel, driving a text layer and a shape layer.
 *
 * Everything here asserts on what the CANVAS ended up rendering, not on what
 * the control says. The panel is only interesting because the artboard is what
 * gets exported, and the two are separated by `applyTextUpdate` ->
 * `handleArtboardsUpdate` -> a re-render, which is exactly where a regression
 * would hide.
 */

/** The rendered glyph box of the text layer on the first board. */
const textBody = (app: Editor): Locator =>
  app.board(0).locator('[data-text-body="true"]').first();

/**
 * One computed property of a rendered node.
 * Read through `expect.poll`, because every panel edit lands asynchronously:
 * the update is folded into the artboard state and only then re-rendered.
 */
function computed(node: Locator, property: string): Promise<string> {
  return node.evaluate(
    (element, name) => getComputedStyle(element).getPropertyValue(name),
    property
  );
}

async function expectComputed(node: Locator, property: string, value: string): Promise<void> {
  await expect.poll(() => computed(node, property), { timeout: 15_000 }).toBe(value);
}

// Shape controls the Editor page object does not expose yet. Same policy as
// the text controls: PropertiesPanel gives every one of them an id.
const fillColorInput = (app: Editor): Locator => app.page.locator('#fillColor');
const fillOpacityInput = (app: Editor): Locator => app.page.locator('#fillOpacity');
const uniformRadiusInput = (app: Editor): Locator => app.page.locator('#uniformRadius');

/** The painted shape inside a rectangle layer: the div carrying the fill. */
const shapeFill = (app: Editor): Locator =>
  app.board(0).locator('[data-element-id] div[style*="background-color"]').first();

/** Add a Basic library item to a blank project and leave it selected. */
async function addBasic(app: Editor, label: string, libraryId: string): Promise<Locator> {
  await app.startBlankProject();
  await app.ensurePaletteOpen();
  await app.addElementFrom('Basic', label, libraryId);
  const element = app.elementsOn(0).first();
  await expect(element).toBeVisible();
  return element;
}

test.describe('text properties', () => {
  test('the content box commits on blur, reaches the canvas and reaches the database', async ({ app, page }) => {
    await addBasic(app, 'Text', 'basic:text');
    const body = textBody(app);
    await expect(body).toHaveText('New Text');

    await app.textContentInput.fill('Ship it');
    // Typing alone must NOT rewrite the canvas: the panel holds the edit in
    // local state so a keystroke does not push a history entry per character.
    await expect(body).toHaveText('New Text');

    await app.textContentInput.blur();
    await expect(body).toHaveText('Ship it');

    // And the commit went through handleArtboardsUpdate, which is the only
    // door that persists. A write that skipped it would still paint.
    const saved = await waitForProject(page, (project) =>
      JSON.stringify(project.projectData).includes('Ship it')
    );
    expect(JSON.stringify(saved.projectData)).not.toContain('New Text');
  });

  test('font size renders at fontSize over 0.3, which every export depends on', async ({ app }) => {
    await addBasic(app, 'Text', 'basic:text');
    const body = textBody(app);

    // AGENTS.md rule 3. The artboard is laid out at full store resolution and
    // shrunk by a 0.3 transform, so authored type has to be divided back out
    // or a 48pt headline would export a third of the size it was designed at.
    await expect(app.fontSizeInput).toHaveValue('48');
    await expectComputed(body, 'font-size', '160px');

    await app.fontSizeInput.fill('30');
    await expectComputed(body, 'font-size', '100px');

    await app.fontSizeInput.fill('48');
    await expectComputed(body, 'font-size', '160px');
  });

  test('growing the content grows the box around its centre instead of clipping', async ({ app }) => {
    const element = await addBasic(app, 'Text', 'basic:text');
    const body = textBody(app);
    const before = await elementPosition(element);

    // The rendered box has overflow: hidden, so without fitTextBox the added
    // lines would simply vanish. fitTextBox splits the growth above and below
    // so a headline does not walk down the artboard every time it gains a line.
    await app.textContentInput.fill('One\nTwo\nThree');
    await app.textContentInput.blur();
    await expect(body).toHaveText('One\nTwo\nThree');

    await expect
      .poll(async () => (await elementPosition(element)).height, { timeout: 15_000 })
      .toBeGreaterThan(before.height);

    const after = await elementPosition(element);
    const grown = after.height - before.height;
    expect(after.top).toBeCloseTo(before.top - grown / 2, 0);
    expect(after.width).toBe(before.width);

    // The point of the resize: nothing is cut off any more.
    const overflow = await body.evaluate((node) => node.scrollHeight - node.clientHeight);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('colour and line height reach the rendered text', async ({ app }) => {
    await addBasic(app, 'Text', 'basic:text');
    const body = textBody(app);
    await expectComputed(body, 'color', 'rgb(51, 51, 51)');

    await app.fontColorInput.fill('#ff0000');
    await expectComputed(body, 'color', 'rgb(255, 0, 0)');

    // Line height is a unitless multiplier on the COMPENSATED size, so 2 on a
    // 48pt layer is 320px and not 96px.
    await expect(app.lineHeightInput).toHaveValue('1.2');
    await expectComputed(body, 'line-height', '192px');
    await app.lineHeightInput.fill('2');
    await expectComputed(body, 'line-height', '320px');
  });

  test('bold, italic and underline toggle the rendered style both ways', async ({ app, page }) => {
    await addBasic(app, 'Text', 'basic:text');
    const body = textBody(app);

    await page.getByTitle('Bold').click();
    await expectComputed(body, 'font-weight', '700');
    await page.getByTitle('Italic').click();
    await expectComputed(body, 'font-style', 'italic');
    await page.getByTitle('Underline').click();
    await expectComputed(body, 'text-decoration-line', 'underline');

    // These are toggles, not setters. A second click has to take the style off
    // again, which is the half that regresses.
    await page.getByTitle('Bold').click();
    await expectComputed(body, 'font-weight', '400');
    await page.getByTitle('Underline').click();
    await expectComputed(body, 'text-decoration-line', 'none');
    await expectComputed(body, 'font-style', 'italic');
  });

  test('alignment is applied logically, so it follows the language direction', async ({ app, page }) => {
    await addBasic(app, 'Text', 'basic:text');
    const body = textBody(app);
    await expectComputed(body, 'text-align', 'start');
    await expectComputed(body, 'justify-content', 'flex-start');

    await page.getByTitle('Align Center').click();
    await expectComputed(body, 'text-align', 'center');
    await expectComputed(body, 'justify-content', 'center');

    // 'right' renders as `end`, not `right`: the box carries dir="auto", so an
    // Arabic translation of the same layer has to land on the other side
    // without a second position.
    await page.getByTitle('Align Right').click();
    await expectComputed(body, 'text-align', 'end');
    await expectComputed(body, 'justify-content', 'flex-end');

    await page.getByTitle('Align Left').click();
    await expectComputed(body, 'text-align', 'start');
    await expectComputed(body, 'justify-content', 'flex-start');
  });
});

test.describe('shape properties', () => {
  test('selecting a shape swaps the panel over to the shape section', async ({ app }) => {
    await addBasic(app, 'Rectangle', 'basic:rectangle');
    const panel = app.activeDockPanel;

    await expect(panel).toContainText('Shape Properties');
    await expect(fillColorInput(app)).toBeVisible();
    await expect(fillOpacityInput(app)).toBeVisible();
    // The text controls belong to another element type and must be gone, not
    // merely hidden behind a mounted inactive panel.
    await expect(app.textContentInput).toHaveCount(0);
  });

  test('fill colour and fill opacity repaint the shape', async ({ app }) => {
    await addBasic(app, 'Rectangle', 'basic:rectangle');
    const fill = shapeFill(app);
    await expectComputed(fill, 'background-color', 'rgb(95, 158, 160)');

    await fillColorInput(app).fill('#00ff00');
    await expectComputed(fill, 'background-color', 'rgb(0, 255, 0)');

    // Fill opacity is folded into the colour's alpha channel rather than set
    // as an element opacity, so a stroke stays solid over a see-through fill.
    await fillOpacityInput(app).fill('0.5');
    await expectComputed(fill, 'background-color', 'rgba(0, 255, 0, 0.5)');
  });

  test('the corner radius slider rounds the rectangle', async ({ app }) => {
    await addBasic(app, 'Rectangle', 'basic:rectangle');
    const fill = shapeFill(app);
    await expectComputed(fill, 'border-radius', '0px');

    await uniformRadiusInput(app).fill('40');
    await expectComputed(fill, 'border-radius', '40px');
  });
});

test.describe('library id', () => {
  test('the panel names the library item each layer came from', async ({ app }) => {
    await addBasic(app, 'Text', 'basic:text');
    const panel = app.activeDockPanel;
    await expect(panel).toContainText('Library ID');
    await expect(panel.locator('code', { hasText: 'basic:text' })).toBeVisible();
    await expect(panel.getByTitle('Copy library id')).toBeVisible();

    // The id is per layer, not per session: adding a second item has to move
    // the row on with the selection.
    await app.page.getByRole('button', { name: 'Add Circle (basic:circle)', exact: true }).click();
    await expect(app.elementsOn(0)).toHaveCount(2);
    await expect(panel.locator('code', { hasText: 'basic:circle' })).toBeVisible();
  });

  test.describe('copying it', () => {
    // WebKit refuses navigator.clipboard.readText outright, and Playwright's
    // WebKit build rejects the clipboard permission names, so the round trip
    // is only observable on Chromium. The desktop project is WebKit.
    test.skip(
      ({ browserName }) => browserName !== 'chromium',
      'WebKit has no clipboard-read permission and denies navigator.clipboard.readText'
    );
    test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

    test('the copy button puts the library id on the clipboard', async ({ app, page }) => {
      await addBasic(app, 'Rectangle', 'basic:rectangle');
      const panel = app.activeDockPanel;

      await panel.getByTitle('Copy library id').click();

      // The tick only appears once writeText resolved, so it is the app's own
      // proof the copy happened rather than a guess at it.
      await expect(panel.getByRole('button', { name: 'Copied' })).toBeVisible();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('basic:rectangle');
    });
  });
});
