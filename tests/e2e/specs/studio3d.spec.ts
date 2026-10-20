import { test, expect, type Page } from '../fixtures/test';
import type { Locator } from '@playwright/test';
import type { Editor } from '../helpers/editor';
import { waitForProject, type StoredProject } from '../fixtures/db';

/**
 * The 3D Studio device: a measured iPhone or Pixel turned to any angle on the canvas.
 *
 * Nothing here reads pixels. The desktop project runs WebKit, whose WebGL is
 * not the one users have, so the checks are on what the editor commits: the
 * model, angle and finish in the saved project, the box fitted round the
 * device, and the history entry. The rendering itself is checked by
 * regen-studio-thumbs.js and the unit tests of device3dStudio.ts.
 */

interface SavedDevice {
  id: string;
  deviceType: string;
  styleType?: string;
  rotation3d?: { yaw: number; pitch: number; roll: number };
  finish3d?: string;
  bodyColor3d?: string;
  fold3d?: number;
  hinge3d?: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
}

function devices(project: StoredProject): SavedDevice[] {
  const boards = (project.projectData as Array<{ elements?: SavedDevice[] }>) ?? [];
  return boards.flatMap((board) => board.elements ?? []);
}

const studioDevices = (project: StoredProject) => devices(project).filter((el) => el.styleType === '3d-studio');

/** The palette angle every studio tile arrives at (STUDIO_TILE_LOOK, 'hero'). */
const TILE_ANGLE = { yaw: 24, pitch: -12, roll: -8 };

async function addStudioPhone(app: Editor): Promise<void> {
  await app.paletteTab('Devices').click();
  await app.openPaletteCategory('3D Studio');
  await app.addElement('iPhone 17 Pro Max in 3D', 'studio3d:iphone-17-pro-max');
}

/** Press, move in steps, release: a drag the handle sees as pointer moves. */
async function dragBy(page: Page, target: Locator, dx: number, dy: number, from = { x: 0.5, y: 0.5 }): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error('The drag target has no bounding box; is it on screen?');
  const x = box.x + box.width * from.x;
  const y = box.y + box.height * from.y;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x + (dx * i) / 10, y + (dy * i) / 10);
  await page.mouse.up();
}

/** Keep the color change and next choice in one task, before the debounce can fire. */
async function colorThenClick(input: Locator, color: string, selector: string): Promise<void> {
  await input.evaluate((node, next) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(node, next.color);
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
    const target = document.querySelector<HTMLElement>(next.selector);
    if (!target) throw new Error(`No control matches ${next.selector}`);
    target.click();
  }, { color, selector });
}

test.describe('3D Studio device', () => {
  test('a model tile adds that iPhone at the palette angle in its own default finish', async ({ app, page }) => {
    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await addStudioPhone(app);

    await expect(app.activeDockPanel.getByText('3D Studio', { exact: true })).toBeVisible();
    await expect(app.activeDockPanel.getByText('Finish: Cosmic Orange')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Rotate in 3D' })).toBeVisible();

    const saved = await waitForProject(page, (project) => studioDevices(project).length === 1);
    const [phone] = studioDevices(saved);
    expect(phone.deviceType).toBe('iphone-17-pro-max');
    expect(phone.rotation3d).toEqual(TILE_ANGLE);
    expect(phone.finish3d).toBe('cosmic-orange');
  });

  test('an Android tile adds that Pixel at the palette angle in its own default finish', async ({ app, page }) => {
    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await app.paletteTab('Devices').click();
    await app.openPaletteCategory('3D Studio');
    await app.addElement('Pixel 3 XL in 3D', 'studio3d:pixel-3-xl');

    await expect(app.activeDockPanel.getByText("Pixel 3 XL, built to Google's device frame and hardware diagram")).toBeVisible();
    await expect(app.activeDockPanel.getByText('Finish: Clearly White')).toBeVisible();

    const saved = await waitForProject(page, (project) => studioDevices(project).length === 1);
    const [phone] = studioDevices(saved);
    expect(phone.deviceType).toBe('pixel-3-xl');
    expect(phone.rotation3d).toEqual(TILE_ANGLE);
    expect(phone.finish3d).toBe('clearly-white');
  });

  test('the iPhone Duo arrives held tall and nearly open, and a fold pose closes it in one undo step', async ({ app, page }) => {
    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await app.paletteTab('Devices').click();
    await app.openPaletteCategory('3D Studio');
    await app.addElement('iPhone Duo in 3D', 'studio3d:iphone-duo');

    await expect(app.activeDockPanel.getByText("iPhone Duo, built to Apple's tech specs and product bezels")).toBeVisible();
    await expect(app.activeDockPanel.getByText('Opening: 160°')).toBeVisible();
    const [arrived] = studioDevices(await waitForProject(page, (project) => studioDevices(project).length === 1));
    expect(arrived.deviceType).toBe('iphone-duo');
    expect(arrived.fold3d).toBe(160);
    expect(arrived.hinge3d).toBe('across');
    expect(arrived.size.height).toBeGreaterThan(arrived.size.width);

    await app.activeDockPanel.getByRole('button', { name: 'Closed pose', exact: true }).click();
    const saved = await waitForProject(page, (project) => studioDevices(project)[0]?.fold3d === 0);
    const [closed] = studioDevices(saved);
    expect(closed.hinge3d).toBe('upright');
    // Closed and upright it is narrower than open and held tall, and the box closes round it.
    expect(closed.size.width).toBeLessThan(arrived.size.width);
    await expect(app.activeDockPanel.getByText('Opening: 0°')).toBeVisible();

    await app.dockTab('History').click();
    await expect(app.activeDockPanel.getByText('Fold').first()).toBeVisible();
  });

  test("dragging the Duo's fold grip folds it in one undo step, and a double-click opens it flat", async ({ app, page }) => {
    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await app.paletteTab('Devices').click();
    await app.openPaletteCategory('3D Studio');
    await app.addElement('iPhone Duo in 3D', 'studio3d:iphone-duo');
    const [before] = studioDevices(await waitForProject(page, (project) => studioDevices(project).length === 1));
    expect(before.fold3d).toBe(160);

    // Held tall, the half that swings is the lower one, so its grip is below the middle.
    const grip = page.getByRole('button', { name: 'Fold or unfold' });
    await expect(grip).toBeVisible();
    const gripBox = (await grip.boundingBox())!;
    const box = (await page.locator(`[data-element-id="${before.id}"]`).first().boundingBox())!;
    expect(gripBox.y + gripBox.height / 2).toBeGreaterThan(box.y + box.height / 2);

    // Pushing the grip up toward the hinge folds the phone partway.
    await dragBy(page, grip, 0, -box.height * 0.25);
    const saved = await waitForProject(page, (project) => (studioDevices(project)[0]?.fold3d ?? 160) < 145);
    const [folded] = studioDevices(saved);
    expect(folded.fold3d!).toBeGreaterThan(40);
    expect(folded.hinge3d).toBe('across');
    await expect(app.activeDockPanel.getByText(`Opening: ${folded.fold3d}°`)).toBeVisible();

    await grip.dblclick();
    await waitForProject(page, (project) => studioDevices(project)[0]?.fold3d === 180);

    // Each fold is one step back.
    await app.undoButton.click();
    await waitForProject(page, (project) => studioDevices(project)[0]?.fold3d === folded.fold3d);
    await app.undoButton.click();
    await waitForProject(page, (project) => studioDevices(project)[0]?.fold3d === 160);
  });

  test('the panel sliders follow a drag as it happens, on the canvas or on the slider', async ({ app, page }) => {
    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await app.paletteTab('Devices').click();
    await app.openPaletteCategory('3D Studio');
    await app.addElement('iPhone Duo in 3D', 'studio3d:iphone-duo');
    await waitForProject(page, (project) => studioDevices(project).length === 1);
    const panel = app.activeDockPanel;
    await expect(panel.getByText('Opening: 160°')).toBeVisible();

    // Mid-drag on the fold grip, before anything is saved, the panel already reads the new opening.
    const grip = page.getByRole('button', { name: 'Fold or unfold' });
    const g = (await grip.boundingBox())!;
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2 - i * 10);
    await expect(panel.getByText('Opening: 160°')).toBeHidden();
    await expect(panel.getByText(/^Opening: \d+°$/)).toBeVisible();
    const shown = await panel.getByText(/^Opening: \d+°$/).textContent();
    await page.mouse.up();
    const saved = await waitForProject(page, (project) => (studioDevices(project)[0]?.fold3d ?? 160) !== 160);
    expect(`Opening: ${studioDevices(saved)[0].fold3d}°`).toBe(shown);

    // And a slider's own label moves with its thumb.
    const turn = panel.getByText(/^Turn: -?\d+°$/);
    const before = await turn.textContent();
    const thumb = panel.locator('#studio-yaw [role="slider"]');
    await thumb.scrollIntoViewIfNeeded();
    const t = (await thumb.boundingBox())!;
    await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(t.x + t.width / 2 + i * 8, t.y + t.height / 2);
    await expect(turn).not.toHaveText(before!);
    await page.mouse.up();
  });

  test('dragging the round handle turns the device in one undo step and refits its box', async ({ app, page }) => {
    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await addStudioPhone(app);
    const [before] = studioDevices(await waitForProject(page, (project) => studioDevices(project).length === 1));

    await dragBy(page, page.getByRole('button', { name: 'Rotate in 3D' }), 120, 0);

    const saved = await waitForProject(page, (project) => {
      const [phone] = studioDevices(project);
      return !!phone && phone.rotation3d?.yaw !== before.rotation3d?.yaw;
    });
    const [after] = studioDevices(saved);
    // A drag across turns it like a turntable: more yaw, nothing else.
    expect(after.rotation3d!.yaw).toBeGreaterThan(before.rotation3d!.yaw + 10);
    expect(after.rotation3d!.pitch).toBe(before.rotation3d!.pitch);
    expect(after.rotation3d!.roll).toBe(before.rotation3d!.roll);
    // The box closes round the turned silhouette.
    expect(after.size.width).not.toBeCloseTo(before.size.width, 0);

    await app.dockTab('History').click();
    await expect(app.activeDockPanel.getByText('Rotate in 3D').first()).toBeVisible();
  });

  test('dragging the device away from the handle moves it without turning it', async ({ app, page }) => {
    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await addStudioPhone(app);
    const [before] = studioDevices(await waitForProject(page, (project) => studioDevices(project).length === 1));

    // Grab the device near its bottom, well clear of the handle in the middle.
    const element = page.locator(`[data-element-id="${before.id}"]`).first();
    await dragBy(page, element, 80, 60, { x: 0.5, y: 0.85 });

    const saved = await waitForProject(page, (project) => {
      const [phone] = studioDevices(project);
      return !!phone && phone.position.x !== before.position.x;
    });
    const [after] = studioDevices(saved);
    expect(after.position.x).toBeGreaterThan(before.position.x);
    expect(after.rotation3d).toEqual(before.rotation3d);
  });

  test('a double-click on the handle turns the device to face the front', async ({ app, page }) => {
    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await addStudioPhone(app);
    await waitForProject(page, (project) => studioDevices(project).length === 1);

    await page.getByRole('button', { name: 'Rotate in 3D' }).dblclick();

    const saved = await waitForProject(page, (project) => {
      const [phone] = studioDevices(project);
      return !!phone && phone.rotation3d?.yaw === 0 && phone.rotation3d?.pitch === 0;
    });
    expect(studioDevices(saved)[0].rotation3d).toEqual({ yaw: 0, pitch: 0, roll: 0 });
  });

  test('a finish swatch puts the phone in one of its own finishes', async ({ app, page }) => {
    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await addStudioPhone(app);

    await app.activeDockPanel.getByRole('button', { name: 'Deep Blue finish' }).click();

    const saved = await waitForProject(page, (project) => studioDevices(project)[0]?.finish3d === 'deep-blue');
    expect(studioDevices(saved)[0].bodyColor3d).toBe('');
    await expect(app.activeDockPanel.getByText('Finish: Deep Blue')).toBeVisible();
  });

  test('a named finish supersedes a pending custom color', async ({ app, page }) => {
    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await addStudioPhone(app);

    await colorThenClick(
      app.activeDockPanel.getByLabel('Custom finish color'),
      '#12ab34',
      '[role="tabpanel"][data-state="active"] button[aria-label="Deep Blue finish"]'
    );

    await page.waitForTimeout(650);
    const saved = await waitForProject(page, (project) => studioDevices(project)[0]?.finish3d === 'deep-blue');
    expect(studioDevices(saved)[0].bodyColor3d).toBe('');
    await expect(app.activeDockPanel.getByText('Finish: Deep Blue')).toBeVisible();
  });

  test('pending custom colors stay with their layer when selecting another phone or the artboard', async ({ app, page }) => {
    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await addStudioPhone(app);
    const [first] = studioDevices(await waitForProject(page, (project) => studioDevices(project).length === 1));
    await app.addElement('iPhone 17 Pro Max in 3D', 'studio3d:iphone-17-pro-max');
    const both = studioDevices(await waitForProject(page, (project) => studioDevices(project).length === 2));
    const second = both.find((phone) => phone.id !== first.id)!;
    const colorInput = app.activeDockPanel.getByLabel('Custom finish color');
    const defaultColor = await colorInput.inputValue();

    await colorThenClick(colorInput, '#12ab34', `[data-drop-anchor="${first.id}"] button[title^="Double-click to rename"]`);
    await expect(colorInput).toHaveValue(defaultColor);
    const selected = await waitForProject(page, (project) => studioDevices(project).find((phone) => phone.id === second.id)?.bodyColor3d === '#12ab34');
    expect(studioDevices(selected).find((phone) => phone.id === first.id)?.bodyColor3d).toBeUndefined();

    await colorThenClick(colorInput, '#654321', '[data-artboard-dom-id]');
    await expect(colorInput).toHaveCount(0);
    const deselected = await waitForProject(page, (project) => studioDevices(project).find((phone) => phone.id === first.id)?.bodyColor3d === '#654321');
    expect(studioDevices(deselected).find((phone) => phone.id === second.id)?.bodyColor3d).toBe('#12ab34');
  });

  test('switching a posed 3D device to the 3D Studio keeps its pose and picks the nearest finish', async ({ app, page }) => {
    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await app.paletteTab('Devices').click();
    await app.openPaletteCategory('3D iPhone 17 Pro Max');
    await app.addElement('iPhone 17 Pro Max 3D, tilted right (black)', 'device3d:iphone-tilted-right-black');

    await page.locator('#deviceStyleType').click();
    await page.getByRole('option', { name: '3D Studio (any angle)', exact: true }).click();

    const saved = await waitForProject(page, (project) => studioDevices(project).length === 1);
    const [phone] = studioDevices(saved);
    expect(phone.rotation3d).toEqual({ yaw: -30, pitch: 26, roll: 0 });
    expect(phone.finish3d).toBe('deep-blue');
    await expect(app.activeDockPanel.getByRole('button', { name: 'Tilted look' })).toHaveAttribute('aria-pressed', 'true');
  });
});
