import { test, expect } from '../fixtures/test';
import { expectBoardSize } from '../helpers/canvas';

test.describe('editor boot', () => {
  test('an empty database opens the start dialog with all three ways in', async ({ app }) => {
    const dialog = app.startDialog;
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Start with a blank canvas/i })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Drop your screenshots/i })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Start with the AI agent/i })).toBeVisible();
    await expect(dialog.getByRole('tab', { name: /App Screenshots/ })).toBeVisible();
  });

  test('the editor chrome hydrates once the start dialog is out of the way', async ({ app }) => {
    // Radix marks everything outside an open modal aria-hidden, so a
    // role-based locator cannot see the editor until the dialog closes. That
    // is correct behaviour, and it is why this asserts after, not before.
    await app.dismissStartDialog();
    await app.ensurePaletteOpen();
    await expect(app.exportButton).toBeVisible();
    await expect(app.createButton).toBeVisible();
    await expect(app.paletteTab('Elements')).toBeVisible();
    await expect(app.paletteTab('Devices')).toBeVisible();
    await expect(app.dockTab('Properties')).toBeVisible();
    await expect(app.dockTab('History')).toBeVisible();
    await expect(app.dockTab('Versions')).toBeVisible();
    await expect(app.selectionTool).toBeVisible();
    await expect(app.undoButton).toBeVisible();
  });

  test('the + lists every way to start a design, each with what it makes', async ({ app, page }) => {
    await app.startBlankProject();
    const items = [
      ['Start from a template', 'A finished design to fill with your screenshots'],
      ['Start from screenshots', 'Drop in screenshots and get finished designs'],
      ['Make social graphics', 'Link previews, posts, stories and banners'],
      ['App Store header and search art', 'New in iOS 27, built from this project'],
    ] as const;
    const first = page.getByRole('button', { name: items[0][0], exact: true });

    // Resting the mouse on the + is enough to open it, and moving off closes it.
    await app.createButton.hover();
    for (const [name, description] of items) {
      const item = page.getByRole('button', { name, exact: true });
      await expect(item).toBeVisible();
      await expect(item).toHaveAccessibleDescription(description);
    }
    await expect(page.getByRole('group', { name: 'New project' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Add to this project' })).toBeVisible();
    // Far from the menu, wherever the viewport puts it.
    const viewport = page.viewportSize()!;
    await page.mouse.move(viewport.width - 30, viewport.height - 30);
    await expect(first).toBeHidden();

    // A click opens it too, the way a tap does, and the keyboard can walk it.
    await app.createButton.click();
    await expect(first).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('button', { name: items[1][0], exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(first).toBeHidden();
  });

  test('a blank project lands one artboard at the required iPhone size', async ({ app }) => {
    await app.startBlankProject();
    await expect(app.artboards).toHaveCount(1);
    // 1206x2622 is the App Store's required iPhone slot (medium display), and
    // the app's default.
    await expectBoardSize(app.board(0), 1206, 2622);
    await expect(app.canvasSizeButton).toHaveAttribute('title', /1206 × 2622/);
  });

  test('the editor survives every external host being unreachable', async ({ app, page }) => {
    // The `hermetic` fixture aborts everything off the origin. A design tool
    // must still open: the community feed, analytics and the font CDN are all
    // optional.
    await app.startBlankProject();
    await expect(app.artboards.first()).toBeVisible();
    expect(await page.title()).toContain('Open Screenshot Generator');
  });
});

test.describe('platform detection', () => {
  test('the app takes the branch its host implies', async ({ app, page, tauri, isDesktop }) => {
    const sawTauri = await page.evaluate(() => '__TAURI_INTERNALS__' in window);
    expect(sawTauri).toBe(isDesktop);

    if (isDesktop) {
      // AppReadySignal closes the native splash once the tree has mounted.
      // If this stops firing, desktop users get a splash that only the Rust
      // side's 12s fallback timer clears.
      const call = await tauri.waitForCall('abs_app_ready', 30_000);
      expect(call.cmd).toBe('abs_app_ready');
    } else {
      expect(await tauri.calls()).toHaveLength(0);
    }
    await app.dismissStartDialog();
  });

  test('no desktop command goes unanswered by the harness', async ({ app, tauri, isDesktop }) => {
    test.skip(!isDesktop, 'desktop only');
    await app.startBlankProject();
    // A name here means the app grew a Tauri command the runtime does not
    // model yet, which is a real gap rather than test noise.
    expect(await tauri.unhandled()).toEqual([]);
  });
});
