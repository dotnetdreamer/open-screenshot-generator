import { readFileSync } from 'node:fs';
import type { Download, Page } from '@playwright/test';
import { test, expect } from '../fixtures/test';
import { put } from '../fixtures/db';
import { expectBoardSize } from '../helpers/canvas';
import type { Editor } from '../helpers/editor';

/**
 * The app icon (src/lib/appIcon/, components/.../appIcon/): made from the +
 * menu out of the project's own look, kept apart from the screenshots,
 * previewed and checked in its window, and exported for every store, as a
 * zip on the web and through Rust on the desktop.
 */

function iconDialog(page: Page) {
  return page.getByTestId('app-icon-dialog');
}

/** The + menu, a starter, Add. Leaves the window open on the new icon. */
async function addIcon(app: Editor, page: Page, starter = 'Ring') {
  await app.create('App icon');
  const dialog = iconDialog(page);
  await expect(dialog.getByRole('heading', { name: 'Make your app icon' })).toBeVisible();
  await dialog.getByLabel('App name').fill('Pebble Notes');
  await dialog.getByRole('radio', { name: starter, exact: true }).click();
  await dialog.getByRole('button', { name: 'Add icon', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'App icon', exact: true })).toBeVisible();
  return dialog;
}

/** A check in the window's list, once the measurement behind it is in. */
function check(page: Page, id: string) {
  return iconDialog(page).getByTestId('app-icon-checks').locator(`[data-check="${id}"]`);
}

/** The files of a zip, read off its central directory. */
function readZip(zip: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    const size = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    const local = zip.readUInt32LE(at + 42);
    const localName = zip.readUInt16LE(local + 26);
    const localExtra = zip.readUInt16LE(local + 28);
    const start = local + 30 + localName + localExtra;
    out.set(name, zip.subarray(start, start + size));
    at += 46 + nameLength;
  }
  return out;
}

/** Width, height and colour type from a PNG's header: type 2 has no alpha channel, 6 has one. */
function png(bytes: Buffer) {
  expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colourType: bytes[25] };
}

/**
 * Seed one project and open it, with any others stored beside it first so
 * the start dialog lists them. Seeding needs the app's own schema in place.
 */
async function openStoredProject(
  app: Editor,
  page: Page,
  id: string,
  boards: unknown[],
  others: Array<{ id: string; name: string; projectData: unknown[] }> = []
): Promise<void> {
  await expect(app.startDialog).toBeVisible();
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise<boolean>((resolve) => {
              const open = indexedDB.open('ProjectDatabase');
              open.onerror = () => resolve(false);
              open.onsuccess = () => {
                const has = open.result.objectStoreNames.contains('projects');
                open.result.close();
                resolve(has);
              };
            })
        ),
      { timeout: 30_000 }
    )
    .toBe(true);
  for (const other of others) await put(page, 'projects', { ...other, timestamp: new Date('2026-11-18T09:00:00.000Z') });
  await put(page, 'projects', { id, name: 'Pebble Notes', timestamp: new Date('2026-11-18T10:00:00.000Z'), projectData: boards });
  await app.goto(`/?projectId=${id}`);
  await expect(app.artboards).toHaveCount(boards.length, { timeout: 45_000 });
}

/** The icon artboard of a stored project, as saved. */
async function storedIcon(page: Page, id: string): Promise<unknown> {
  return page.evaluate(
    (projectId) =>
      new Promise((resolve) => {
        const open = indexedDB.open('ProjectDatabase');
        open.onsuccess = () => {
          const read = open.result.transaction('projects').objectStore('projects').get(projectId);
          read.onsuccess = () => {
            const boards = (read.result?.projectData ?? []) as Array<{ appIcon?: unknown }>;
            resolve(boards.find((board) => board.appIcon)?.appIcon ?? null);
            open.result.close();
          };
          read.onerror = () => resolve(null);
        };
        open.onerror = () => resolve(null);
      }),
    id
  );
}

/** An icon whose front is a dark letter over a dark square that fills it. */
function troubledIcon() {
  return {
    id: 'icon-board',
    name: 'App icon',
    position: { x: 0, y: 0 },
    size: { width: 1024, height: 1024 },
    appIcon: {},
    backgroundColor: '#FFFFFF',
    zoom: 1,
    elements: [
      {
        id: 'picture',
        type: 'shape',
        name: 'Picture',
        shapeType: 'rectangle',
        fillColor: '#1F2937',
        strokeColor: 'transparent',
        strokeWidth: 0,
        position: { x: 0, y: 0 },
        size: { width: 1024, height: 1024 },
        rotation: 0,
        scale: 1,
      },
      {
        id: 'letter',
        type: 'text',
        name: 'Letter',
        content: 'P',
        fontSize: 168,
        color: '#111827',
        fontFamily: 'Arial',
        fontWeight: '700',
        textAlign: 'center',
        lineHeight: 1,
        position: { x: 51, y: 147 },
        size: { width: 922, height: 732 },
        rotation: 0,
        scale: 1,
      },
    ],
  };
}

function screenshotBoard() {
  return {
    id: 'shot-1',
    name: 'Screenshot 1',
    position: { x: 0, y: 0 },
    size: { width: 1206, height: 2622 },
    backgroundColor: '#EEF2FF',
    zoom: 1,
    elements: [],
  };
}

test.describe('App icon', () => {
  test('the + menu makes the icon from the project, and the canvas keeps it apart from the screenshots', async ({ app, page }) => {
    await app.startBlankProject();
    await addIcon(app, page);
    // The pixel checks run off the canvas a moment after the icon lands.
    await expect(check(page, 'opaque')).toHaveAttribute('data-level', 'ok', { timeout: 20_000 });
    await expect(check(page, 'safe')).toHaveAttribute('data-level', 'ok');
    await expect(check(page, 'dark')).toHaveAttribute('data-level', 'ok');
    await page.keyboard.press('Escape');
    await expect(iconDialog(page)).toBeHidden();

    // The icon goes in front of the screenshots, at its own size, with its guides and chip.
    await expect(app.artboards).toHaveCount(2);
    await expectBoardSize(app.board(0), 1024, 1024);
    await expectBoardSize(app.board(1), 1206, 2622);
    await expect(page.getByTestId('app-icon-guides')).toBeVisible();
    await expect(page.getByTestId('app-icon-badge')).toContainText('App icon');
    await expect(page.getByTestId('app-icon-badge')).toContainText('Ready');
    // Selected, so the live preview shows it in four looks.
    const card = page.getByTestId('app-icon-live-card');
    await expect(card).toBeVisible();
    await expect(card.getByRole('img', { name: /^(Light|Dark|Tinted|Android) icon$/ })).toHaveCount(4);

    // A Canvas Size change is the screenshots' alone.
    await app.canvasSizeButton.click();
    await expect(app.canvasSizeDialog).toBeVisible();
    await app.canvasSizeDialog.locator('#size-ios-6-9').click();
    await app.canvasSizeDialog.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(app.canvasSizeDialog).toBeHidden();
    await expectBoardSize(app.board(0), 1024, 1024);
    await expectBoardSize(app.board(1), 1290, 2796);

    // The chip opens the window on the icon.
    await page.getByTestId('app-icon-badge').click();
    await expect(iconDialog(page).getByRole('heading', { name: 'App icon', exact: true })).toBeVisible();
  });

  test('the window shows the icon on each system, at real size, in each look', async ({ app, page }) => {
    await app.startBlankProject();
    const dialog = await addIcon(app, page, 'Letter');
    const scene = dialog.getByTestId('app-icon-scene');
    await expect(scene).toHaveAttribute('data-platform', 'ios');
    await expect(scene.getByRole('img', { name: /Pebble Notes on an iPhone Home Screen, light icons/ })).toBeVisible();
    await expect(dialog.getByTestId('app-icon-real-sizes').locator('li')).toHaveCount(4);
    await dialog.getByRole('radiogroup', { name: 'Look' }).getByRole('radio', { name: 'Tinted' }).click();
    await expect(scene.getByRole('img', { name: /tinted icons/ })).toBeVisible();
    await expect(dialog.getByRole('radiogroup', { name: 'Tint colour' })).toBeVisible();

    await dialog.getByRole('radiogroup', { name: 'Where' }).getByRole('radio', { name: 'Android' }).click();
    await expect(scene).toHaveAttribute('data-platform', 'android');
    await dialog.getByRole('radiogroup', { name: 'Shape' }).getByRole('radio', { name: 'Soft square' }).click();
    await dialog.getByRole('radiogroup', { name: 'Look' }).getByRole('radio', { name: 'Themed' }).click();
    await expect(scene.getByRole('img', { name: /squircle icons, themed/ })).toBeVisible();
    await expect(dialog.getByTestId('app-icon-real-sizes').locator('li')).toHaveCount(3);

    await dialog.getByRole('radiogroup', { name: 'Where' }).getByRole('radio', { name: 'Mac' }).click();
    await expect(scene.getByRole('img', { name: /on a Mac desktop and in the Dock/ })).toBeVisible();
    await expect(dialog.getByTestId('app-icon-real-sizes').locator('figure')).toHaveCount(4);

    await dialog.getByRole('radiogroup', { name: 'Where' }).getByRole('radio', { name: 'Stores' }).click();
    await expect(dialog.getByRole('img', { name: 'Pebble Notes icon in the App Store' })).toBeVisible();
    await expect(dialog.getByRole('img', { name: 'Pebble Notes icon on Google Play' })).toBeVisible();
  });

  test('a front that fills the icon moves to the background, and a dark one turns white in dark mode', async ({ app, page }) => {
    await openStoredProject(app, page, 'icon-checks', [troubledIcon(), screenshotBoard()]);
    await page.getByTestId('app-icon-badge').click();
    const dialog = iconDialog(page);
    await expect(dialog.getByRole('heading', { name: 'App icon', exact: true })).toBeVisible();

    const front = check(page, 'front');
    await expect(front).toHaveAttribute('data-level', 'warn', { timeout: 20_000 });
    await expect(front).toContainText('The front fills the whole icon');
    await front.getByRole('button', { name: 'Move Picture to the back' }).click();
    // Measured again on the changed canvas: the square is now behind, the dark letter alone in front.
    await expect(front).toHaveCount(0, { timeout: 20_000 });
    const dark = check(page, 'dark');
    await expect(dark).toHaveAttribute('data-level', 'warn');
    await dark.getByRole('button', { name: 'Make the icon white in dark mode' }).click();
    await expect(dark).toHaveAttribute('data-level', 'ok', { timeout: 20_000 });
    await expect(dialog.getByRole('radiogroup', { name: 'Dark and tinted icons' }).getByRole('radio', { name: 'White' })).toHaveAttribute('aria-checked', 'true');
  });

  test('a dark letter on a dark square is fixed in one change: the square behind, the letter white', async ({ app, page }) => {
    await openStoredProject(app, page, 'icon-both-fix', [troubledIcon(), screenshotBoard()]);
    await page.getByTestId('app-icon-badge').click();
    const dark = check(page, 'dark');
    await expect(dark).toHaveAttribute('data-level', 'warn', { timeout: 20_000 });
    // Each fix shows the dark icon it makes before it is clicked.
    const both = dark.getByRole('button', { name: 'Move Picture to the back and make the rest white' });
    await expect(both).toHaveAttribute('title', 'How the dark icon will look');
    await expect(dark.getByRole('button', { name: 'Make the icon white in dark mode' })).toHaveAttribute('title', 'How the dark icon will look');
    await both.click();
    // Measured again: the letter alone in front, white in dark mode, so both checks pass.
    await expect(dark).toHaveAttribute('data-level', 'ok', { timeout: 20_000 });
    await expect(check(page, 'front')).toHaveCount(0);
    await expect(iconDialog(page).getByRole('radiogroup', { name: 'Dark and tinted icons' }).getByRole('radio', { name: 'White' })).toHaveAttribute('aria-checked', 'true');
    // One change: a single Undo puts both back.
    await page.keyboard.press('Escape');
    await expect(iconDialog(page)).toBeHidden();
    await app.undoButton.click();
    await page.getByTestId('app-icon-badge').click();
    await expect(check(page, 'dark')).toHaveAttribute('data-level', 'warn', { timeout: 20_000 });
    await expect(check(page, 'front')).toHaveAttribute('data-level', 'warn');
    await expect(iconDialog(page).getByRole('radiogroup', { name: 'Dark and tinted icons' }).getByRole('radio', { name: 'Your colours' })).toHaveAttribute('aria-checked', 'true');
  });

  test('the Properties panel puts a layer in the background, and the canvas draws it under the front', async ({ app, page }) => {
    await app.startBlankProject();
    await addIcon(app, page, 'Letter');
    await page.keyboard.press('Escape');
    // Until the window has gone, the page behind it is hidden from the accessibility tree.
    await expect(iconDialog(page)).toBeHidden();
    // A circle added to the icon lands on top of the letter, in the front.
    await app.ensurePaletteOpen();
    await app.addElementFrom('Basic', 'Circle', 'basic:circle');
    const ids = () => app.board(0).locator('[data-element-id]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-element-id') ?? ''));
    const before = await ids();
    expect(before).toHaveLength(2);
    expect(before[0]).toMatch(/-mark$/);
    const circle = before[1];
    await page.getByTitle('Double-click to rename "Circle Shape"').click();
    const layer = page.getByTestId('icon-layer-control');
    await expect(layer.getByRole('radio', { name: 'Front' })).toHaveAttribute('aria-checked', 'true');
    // Nothing on an icon continues onto another artboard.
    await expect(page.getByText('Continue across artboards')).toHaveCount(0);
    await layer.getByRole('radio', { name: 'Back' }).click();
    await expect(layer.getByRole('radio', { name: 'Back' })).toHaveAttribute('aria-checked', 'true');
    // In the background it is drawn under the letter, the way the layers export.
    await expect.poll(ids).toEqual([circle, before[0]]);
  });

  test('the app name field keeps what is typed, spaces and all, and an empty one falls back to the project name', async ({ app, page }) => {
    await app.startBlankProject();
    const dialog = await addIcon(app, page, 'Letter');
    const field = dialog.getByRole('textbox', { name: 'App name' });
    await field.fill('');
    await field.pressSequentially('New Name');
    await expect(field).toHaveValue('New Name');
    await expect(dialog.locator('[aria-label^="New Name on an iPhone Home Screen"]')).toHaveCount(1);
    // Emptied, the field stays empty; the project's name shows in grey and in the previews.
    await field.fill('');
    await expect(field).toHaveValue('');
    const placeholder = (await field.getAttribute('placeholder')) ?? '';
    expect(placeholder.length).toBeGreaterThan(0);
    await expect(dialog.locator(`[aria-label^="${placeholder} on an iPhone Home Screen"]`)).toHaveCount(1);
  });

  test('each project keeps the app name typed for its icon, across tabs and a reload', async ({ app, page }) => {
    const iconFor = (id: string) => ({ ...troubledIcon(), id: `icon-${id}`, elements: troubledIcon().elements.map((element) => ({ ...element, id: `${id}-${element.id}` })) });
    const shotFor = (id: string) => ({ ...screenshotBoard(), id: `shot-${id}` });
    await openStoredProject(app, page, 'names_alpha', [iconFor('alpha'), shotFor('alpha')], [
      { id: 'names_beta', name: 'Beta', projectData: [iconFor('beta'), shotFor('beta')] },
    ]);
    const strip = page.locator('[data-project-tabs]');
    const nameField = () => iconDialog(page).getByRole('textbox', { name: 'App name' });
    const openIcon = async () => {
      await page.getByTestId('app-icon-badge').click();
      await expect(iconDialog(page).getByRole('heading', { name: 'App icon', exact: true })).toBeVisible();
    };
    const closeIcon = async () => {
      await page.keyboard.press('Escape');
      await expect(iconDialog(page)).toBeHidden();
    };

    // Alpha's icon gets a name of its own.
    await openIcon();
    await nameField().fill('Alpha Notes');
    await closeIcon();

    // Beta, in a new tab, starts from its own project name and gets another.
    await strip.getByRole('button', { name: 'New tab', exact: true }).click();
    await app.waitForStartDialogReady();
    await app.startDialog.getByText('Beta', { exact: true }).click();
    await expect(app.startDialog).toBeHidden();
    await openIcon();
    await expect(nameField()).toHaveValue('');
    await expect(nameField()).toHaveAttribute('placeholder', 'Beta');
    await nameField().fill('Beta Tasks');
    await closeIcon();

    // Back in Alpha, its name is still its own, and so is Beta's.
    await strip.getByRole('tab').filter({ hasText: 'Pebble Notes' }).click();
    await openIcon();
    await expect(nameField()).toHaveValue('Alpha Notes');
    await closeIcon();
    await strip.getByRole('tab').filter({ hasText: 'Beta' }).click();
    await openIcon();
    await expect(nameField()).toHaveValue('Beta Tasks');
    await closeIcon();

    // The name is saved with the icon, so a reload keeps it.
    await expect.poll(async () => JSON.stringify(await storedIcon(page, 'names_beta')), { timeout: 15_000 }).toContain('Beta Tasks');
    await app.goto('/?projectId=names_alpha');
    await expect(app.artboards).toHaveCount(2, { timeout: 45_000 });
    await openIcon();
    await expect(nameField()).toHaveValue('Alpha Notes');
  });

  test('a screenshot export leaves the icon out, and says where its own export is', async ({ app, page, isDesktop, tauri }) => {
    const downloads: Download[] = [];
    page.on('download', (download) => downloads.push(download));
    await app.startBlankProject();
    await addIcon(app, page);
    await page.keyboard.press('Escape');
    await app.openExportDialog();
    await expect(app.exportDialog.getByText("Your app icon isn't in this export. To save every size of the app icon, use App icon in the + menu")).toBeVisible();
    await expect(app.exportDialog.getByText(/^\d+ PNG files?$/)).toHaveText('1 PNG file');
    await app.exportDialog.getByRole('button', { name: 'Export', exact: true }).click();
    const names = isDesktop
      ? (await tauri.waitForFiles(1, 120_000)).map((file) => file.path.split('/').pop() ?? file.path)
      : await expect.poll(() => downloads.length, { timeout: 120_000 }).toBe(1).then(() => downloads.map((download) => download.suggestedFilename()));
    expect(names).toEqual(['01_Blank_Artboard_iPhone-6_3-Portrait_1206x2622.png']);
  });

  test("the store listing preview shows the project's own icon", async ({ app, page }) => {
    await app.startBlankProject();
    await addIcon(app, page);
    await page.keyboard.press('Escape');
    await app.chooseFromMenu(app.previewButton, /Store listing/i);
    await expect(app.previewDialog).toBeVisible();
    await expect(app.previewDialog.getByRole('img', { name: 'App icon' }).first()).toBeVisible();
  });
});

test.describe('App icon export', () => {
  test('the zip has every file of the stores ticked, and the App Store icon has no alpha channel', async ({ app, page, isDesktop }) => {
    test.skip(isDesktop, 'A browser download; the desktop saves through Rust, below');
    await app.startBlankProject();
    const dialog = await addIcon(app, page, 'Letter');
    await dialog.getByRole('checkbox', { name: /Mac/ }).click();
    await dialog.getByRole('checkbox', { name: /Front and back as two pictures/ }).click();
    const downloading = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Download a zip', exact: true }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe('Pebble Notes icon.zip');
    const files = readZip(readFileSync((await download.path())!));
    const names = [...files.keys()];
    expect(names).toHaveLength(47);
    expect(names.every((name) => name.startsWith('Pebble Notes icon/'))).toBe(true);
    const at = (path: string) => {
      const bytes = files.get(`Pebble Notes icon/${path}`);
      expect(bytes, path).toBeTruthy();
      return bytes!;
    };
    expect(png(at('ios/AppIcon.appiconset/AppIcon.png'))).toEqual({ width: 1024, height: 1024, colourType: 2 });
    expect(png(at('ios/AppIcon.appiconset/AppIcon-Tinted.png')).colourType).toBe(2);
    expect(png(at('ios/AppIcon.appiconset/AppIcon-Dark.png')).colourType).toBe(6);
    const contents = JSON.parse(at('ios/AppIcon.appiconset/Contents.json').toString('utf8'));
    expect(contents.images.map((image: { appearances?: { value: string }[] }) => image.appearances?.[0]?.value ?? 'any')).toEqual(['any', 'dark', 'tinted']);
    expect(png(at('android/res/mipmap-xxxhdpi/ic_launcher_foreground.png'))).toMatchObject({ width: 432, height: 432 });
    expect(png(at('android/res/mipmap-mdpi/ic_launcher.png'))).toMatchObject({ width: 48, height: 48 });
    expect(at('android/res/mipmap-anydpi-v26/ic_launcher.xml').toString('utf8')).toContain('<monochrome android:drawable="@mipmap/ic_launcher_monochrome" />');
    expect(png(at('google-play/icon-512.png'))).toMatchObject({ width: 512, height: 512 });
    expect(png(at('macos/AppIcon.appiconset/icon_16x16.png'))).toMatchObject({ width: 16, height: 16 });
    expect(at('macos/AppIcon.icns').subarray(0, 4).toString('latin1')).toBe('icns');
    expect(png(at('icon-composer/2-front.png')).colourType).toBe(6);
    expect(at('README.txt').toString('utf8')).toContain('Pebble Notes icon, made with Open Screenshot Generator');
    await expect(page.getByText('Icons saved').first()).toBeVisible();
  });

  test('on the desktop, Save to a folder writes every file through Rust, under one new folder', async ({ app, page, isDesktop, tauri }) => {
    test.skip(!isDesktop, 'Folders need the desktop shell');
    await tauri.setOpenPath('/Users/me/Exports');
    await tauri.setResponse('abs_write_export_files', { written: [], leftOver: [] });
    await app.startBlankProject();
    const dialog = await addIcon(app, page, 'Letter');
    await dialog.getByRole('button', { name: 'Export icons' }).click();
    await page.getByRole('menuitem', { name: /Save to a folder/ }).click();
    const call = await tauri.waitForCall('abs_write_export_files', 30_000);
    expect(call.args.directory).toBe('/Users/me/Exports');
    const files = call.args.files as { path: string; dataBase64: string }[];
    // The README, iPhone's 4, Android's 27 and Google Play's 1: the three ticked the first time.
    expect(files).toHaveLength(33);
    expect(files.every((file) => file.path.startsWith('Pebble Notes icon/'))).toBe(true);
    const appIcon = files.find((file) => file.path === 'Pebble Notes icon/ios/AppIcon.appiconset/AppIcon.png')!;
    expect(png(Buffer.from(appIcon.dataBase64, 'base64'))).toEqual({ width: 1024, height: 1024, colourType: 2 });
    await expect(page.getByText('Icons saved').first()).toBeVisible();
    await expect(page.getByText('33 files in /Users/me/Exports/Pebble Notes icon').first()).toBeVisible();
  });

  test('Put in my app project replaces only the places ticked, once the user says which', async ({ app, page, isDesktop, tauri }) => {
    test.skip(!isDesktop, 'An app project on disk needs the desktop shell');
    await tauri.setOpenPath('/Users/me/pebble');
    await tauri.setResponse('abs_scan_icon_targets', {
      iconSets: [
        { path: 'ios/Pebble/Images.xcassets/AppIcon-Pride.appiconset', platform: 'ios' },
        { path: 'ios/Pebble/Images.xcassets/AppIcon.appiconset', platform: 'ios' },
        { path: 'ios/PebbleWatch/Assets.xcassets/AppIcon.appiconset', platform: 'watch' },
      ],
      androidRes: [{ path: 'android/app/src/main/res', anydpi: ['mipmap-anydpi-v26'] }],
      truncated: false,
    });
    await tauri.setResponse('abs_write_export_files', { written: ['a', 'b', 'c', 'd'], leftOver: [] });
    await app.startBlankProject();
    const dialog = await addIcon(app, page, 'Letter');
    await dialog.getByRole('button', { name: 'Export icons' }).click();
    await page.getByRole('menuitem', { name: /Put the icon in my app/ }).click();
    const confirm = dialog.getByTestId('app-icon-project-confirm');
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText('In /Users/me/pebble');
    await expect(confirm).toContainText('ios/Pebble/Images.xcassets/AppIcon.appiconset');
    await expect(confirm).toContainText('android/app/src/main/res');
    // The app's own icon and main res folder are ticked; an alternate icon waits for the user.
    await expect(confirm.getByRole('checkbox', { name: /AppIcon\.appiconset/ })).toBeChecked();
    await expect(confirm.getByRole('checkbox', { name: /AppIcon-Pride/ })).not.toBeChecked();
    await expect(confirm.getByRole('checkbox', { name: /Android/ })).toBeChecked();
    // The watch's icon is shown, and left alone.
    await expect(confirm.getByTestId('app-icon-project-left-alone')).toContainText("Apple Watch icon, won't be changed");
    await expect(confirm.getByRole('checkbox', { name: /PebbleWatch/ })).toHaveCount(0);
    // Nothing is written before the yes.
    expect(await tauri.callsTo('abs_write_export_files')).toHaveLength(0);
    await confirm.getByRole('checkbox', { name: /Android/ }).click();
    // The buttons sit in the bar under the panel, always in view.
    await dialog.getByRole('button', { name: 'Replace the icon' }).click();
    const call = await tauri.waitForCall('abs_write_export_files', 30_000);
    expect(call.args.directory).toBe('/Users/me/pebble');
    expect(call.args.clearIconSets).toEqual(['ios/Pebble/Images.xcassets/AppIcon.appiconset']);
    expect(call.args.replaceResources).toBeNull();
    const paths = (call.args.files as { path: string }[]).map((file) => file.path).sort();
    expect(paths).toEqual(
      ['AppIcon-Dark.png', 'AppIcon-Tinted.png', 'AppIcon.png', 'Contents.json'].map((name) => `ios/Pebble/Images.xcassets/AppIcon.appiconset/${name}`)
    );
    await expect(page.getByText('New icon added to your app').first()).toBeVisible();
  });

  test('Stop stops the files being made, then goes while they are saved, and the save always reports back', async ({ app, page, isDesktop, tauri }) => {
    test.skip(!isDesktop, 'An app project on disk needs the desktop shell');
    await tauri.setOpenPath('/Users/me/pebble');
    await tauri.setResponse('abs_scan_icon_targets', {
      iconSets: [{ path: 'ios/App/Assets.xcassets/AppIcon.appiconset', platform: 'ios' }],
      androidRes: [{ path: 'android/app/src/main/res', anydpi: [] }],
      truncated: false,
    });
    await tauri.setResponse('abs_write_export_files', { written: ['a', 'b'], leftOver: [] });
    await page.evaluate(() => (window as unknown as { __E2E_TAURI__: { config: { held: string[] } } }).__E2E_TAURI__.config.held.push('abs_write_export_files'));
    const heldWrites = () => page.evaluate(() => (window as unknown as { __E2E_TAURI__: { commandsHeld: unknown[] } }).__E2E_TAURI__.commandsHeld.length);
    await app.startBlankProject();
    const dialog = await addIcon(app, page, 'Letter');
    const progress = dialog.getByTestId('app-icon-export-progress');
    const putInApp = async () => {
      await dialog.getByRole('button', { name: 'Export icons' }).click();
      await page.getByRole('menuitem', { name: /Put the icon in my app/ }).click();
      await expect(dialog.getByTestId('app-icon-project-confirm')).toBeVisible();
      await dialog.getByRole('button', { name: 'Replace the icon' }).click();
    };

    // Stopped while the files are made: nothing goes to disk, and the list stays to try again.
    await putInApp();
    await progress.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(page.getByText('Export stopped').first()).toBeVisible();
    await expect(page.getByText('Nothing in your app was changed.').first()).toBeVisible();
    expect(await tauri.callsTo('abs_write_export_files')).toHaveLength(0);
    await expect(dialog.getByTestId('app-icon-project-confirm')).toBeVisible();

    // Once the files are on their way to disk there is no Stop to press, and the answer is shown.
    await dialog.getByRole('button', { name: 'Replace the icon' }).click();
    await expect.poll(heldWrites, { timeout: 60_000 }).toBe(1);
    await expect(progress).toContainText('Saving the files');
    await expect(progress.getByRole('button', { name: 'Stop' })).toHaveCount(0);
    await page.evaluate(() => (window as unknown as { __E2E_TAURI__: { releaseCommands: () => number } }).__E2E_TAURI__.releaseCommands());
    await expect(page.getByText('New icon added to your app').first()).toBeVisible();

    // A save that fails while saving says why.
    await putInApp();
    await expect.poll(heldWrites, { timeout: 60_000 }).toBe(1);
    await page.evaluate(() => {
      const held = (window as unknown as { __E2E_TAURI__: { commandsHeld: { stop: (message: string) => void }[] } }).__E2E_TAURI__.commandsHeld;
      held.shift()!.stop("Couldn't save ios/App/Assets.xcassets/AppIcon.appiconset/AppIcon.png, because the disk is full. Nothing was changed.");
    });
    await expect(page.getByText("The icons couldn't be saved").first()).toBeVisible();
    await expect(page.getByText(/because the disk is full\. Nothing was changed\.$/).first()).toBeVisible();
  });

  test('the desktop asks where to save before it makes the files, so a cancel makes nothing', async ({ app, page, isDesktop, tauri }) => {
    test.skip(!isDesktop, 'Native dialogs need the desktop shell');
    await tauri.setOpenPath(null);
    await tauri.setSavePath(null);
    await app.startBlankProject();
    const dialog = await addIcon(app, page, 'Letter');
    // Anything that starts making files shows the progress line: note if it ever appears.
    await page.evaluate(() => {
      const seen = window as unknown as { __sawProgress?: boolean };
      seen.__sawProgress = false;
      new MutationObserver(() => {
        if (document.querySelector('[data-testid="app-icon-export-progress"]')) seen.__sawProgress = true;
      }).observe(document.body, { childList: true, subtree: true });
    });
    for (const item of [/Save to a folder/, /Save as a zip/]) {
      await dialog.getByRole('button', { name: 'Export icons' }).click();
      await page.getByRole('menuitem', { name: item }).click();
      await expect(dialog.getByRole('button', { name: 'Export icons' })).toBeVisible();
    }
    await expect.poll(() => tauri.callsTo('plugin:dialog|save').then((calls) => calls.length)).toBe(1);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as unknown as { __sawProgress?: boolean }).__sawProgress)).toBe(false);
    expect(await tauri.callsTo('abs_write_export_files')).toHaveLength(0);
    expect(await tauri.callsTo('abs_write_export_zip')).toHaveLength(0);
    expect(await tauri.callsTo('plugin:fs|write_file')).toHaveLength(0);
  });

  test('on the desktop, Save as a zip asks where, then Rust writes the zip in one step', async ({ app, page, isDesktop, tauri }) => {
    test.skip(!isDesktop, 'Native dialogs need the desktop shell');
    await tauri.setSavePath('/Users/me/Exports/');
    await tauri.setResponse('abs_write_export_zip', { written: ['/Users/me/Exports/Pebble Notes icon.zip'], leftOver: [] });
    await app.startBlankProject();
    const dialog = await addIcon(app, page, 'Letter');
    await dialog.getByRole('button', { name: 'Export icons' }).click();
    await page.getByRole('menuitem', { name: /Save as a zip/ }).click();
    const call = await tauri.waitForCall('abs_write_export_zip', 30_000);
    expect(call.args.path).toBe('/Users/me/Exports/Pebble Notes icon.zip');
    const names = [...readZip(Buffer.from(call.args.dataBase64 as string, 'base64')).keys()];
    // The README, iPhone's 4, Android's 27 and Google Play's 1, all in one folder.
    expect(names).toHaveLength(33);
    expect(names.every((name) => name.startsWith('Pebble Notes icon/'))).toBe(true);
    // Not the plain file write that has no rollback and no turn.
    expect(await tauri.callsTo('plugin:fs|write_file')).toHaveLength(0);
    await expect(page.getByText('Icons saved').first()).toBeVisible();
  });

  test('a desktop save names an old copy it could not remove, instead of a plain success', async ({ app, page, isDesktop, tauri }) => {
    test.skip(!isDesktop, 'Folders need the desktop shell');
    await tauri.setOpenPath('/Users/me/Exports');
    await tauri.setResponse('abs_write_export_files', {
      written: ['/Users/me/Exports/Pebble Notes icon/README.txt'],
      leftOver: ["Pebble Notes icon/.README.txt.1-2-0.osg-old: the folder doesn't allow changes"],
    });
    await app.startBlankProject();
    const dialog = await addIcon(app, page, 'Letter');
    await dialog.getByRole('button', { name: 'Export icons' }).click();
    await page.getByRole('menuitem', { name: /Save to a folder/ }).click();
    await expect(page.getByText('Icons saved, but some old copies are still there').first()).toBeVisible();
    await expect(page.getByText('Delete this file: Pebble Notes icon/.README.txt.1-2-0.osg-old').first()).toBeVisible();
    await tauri.setSavePath('/Users/me/Exports/');
    await tauri.setResponse('abs_write_export_zip', {
      written: ['/Users/me/Exports/Pebble Notes icon.zip'],
      leftOver: [".Pebble Notes icon.zip.1-2-0.osg-old: the folder doesn't allow changes"],
    });
    await dialog.getByRole('button', { name: 'Export icons' }).click();
    await page.getByRole('menuitem', { name: /Save as a zip/ }).click();
    await expect(page.getByText('Icons saved, but an old copy is still there').first()).toBeVisible();
  });

  test('the note about more than one iPhone icon goes once one of them is ticked', async ({ app, page, isDesktop, tauri }) => {
    test.skip(!isDesktop, 'An app project on disk needs the desktop shell');
    await tauri.setOpenPath('/Users/me/shared');
    await tauri.setResponse('abs_scan_icon_targets', {
      iconSets: [
        { path: 'Shared/Assets.xcassets/Notes/AppIcon.appiconset', platform: 'ios' },
        { path: 'Shared/Assets.xcassets/Tasks/AppIcon.appiconset', platform: 'ios' },
      ],
      androidRes: [{ path: 'android/app/src/main/res', anydpi: [] }],
      truncated: false,
    });
    await app.startBlankProject();
    const dialog = await addIcon(app, page, 'Letter');
    await dialog.getByRole('button', { name: 'Export icons' }).click();
    await page.getByRole('menuitem', { name: /Put the icon in my app/ }).click();
    const confirm = dialog.getByTestId('app-icon-project-confirm');
    const note = confirm.getByTestId('app-icon-project-rivals');
    await expect(note).toHaveText('This folder has more than one app icon for iPhone and iPad, so none of them is ticked. Tick the icon your app uses');
    await expect(confirm.getByRole('checkbox', { name: /Android/ })).toBeChecked();
    await confirm.getByRole('checkbox', { name: /Notes\/AppIcon/ }).click();
    await expect(note).toHaveCount(0);
    await confirm.getByRole('checkbox', { name: /Notes\/AppIcon/ }).click();
    await expect(note).toBeVisible();
  });

  test('in a small window the export button stays in view and the rest scrolls to it', async ({ app, page, isDesktop }) => {
    await app.startBlankProject();
    const dialog = await addIcon(app, page, 'Letter');
    // The desktop window is never smaller than 1024 by 680.
    const sizes = isDesktop
      ? [{ width: 1024, height: 680 }]
      : [
          { width: 820, height: 700 },
          { width: 1023, height: 640 },
          { width: 1024, height: 680 },
          { width: 1440, height: 900 },
        ];
    for (const size of sizes) {
      await page.setViewportSize(size);
      const action = dialog.getByTestId('app-icon-actions').getByRole('button').first();
      await expect(action, `${size.width} by ${size.height}`).toBeInViewport({ ratio: 1 });
      const [box, frame] = [(await action.boundingBox())!, (await dialog.boundingBox())!];
      expect(box.y + box.height, `${size.width} by ${size.height}`).toBeLessThanOrEqual(frame.y + frame.height);
      expect((await dialog.getByRole('region', { name: 'Previews' }).boundingBox())!.height, `${size.width} by ${size.height}`).toBeGreaterThan(200);
      // The last export choice can be reached with the mouse wheel, as a person scrolls, and ticked.
      // Narrow, the whole window scrolls as one page; wide, the side panel scrolls on its own.
      const scroller = size.width >= 1024 ? dialog.getByRole('complementary', { name: 'Checks and export' }) : dialog.getByTestId('app-icon-body');
      const area = (await scroller.boundingBox())!;
      await page.mouse.move(area.x + area.width / 2, Math.max(area.y, 0) + Math.min(area.height, size.height - Math.max(area.y, 0)) / 2);
      for (let turn = 0; turn < 12; turn++) await page.mouse.wheel(0, 300);
      const last = dialog.getByRole('checkbox', { name: /Front and back as two pictures/ });
      await expect(last, `${size.width} by ${size.height}`).toBeInViewport();
      await last.click();
      await expect(last).toBeChecked();
      await last.click();
    }
  });

  test('old launcher files that could not be removed are named, so the build does not trip on them', async ({ app, page, isDesktop, tauri }) => {
    test.skip(!isDesktop, 'An app project on disk needs the desktop shell');
    await tauri.setOpenPath('/Users/me/pebble');
    await tauri.setResponse('abs_scan_icon_targets', {
      iconSets: [],
      androidRes: [{ path: 'android/app/src/main/res', anydpi: [] }],
      truncated: false,
    });
    await tauri.setResponse('abs_write_export_files', {
      written: ['/Users/me/pebble/android/app/src/main/res/mipmap-hdpi/ic_launcher.png'],
      leftOver: ["android/app/src/main/res/mipmap-hdpi/ic_launcher.webp: the folder doesn't allow changes"],
    });
    await app.startBlankProject();
    const dialog = await addIcon(app, page, 'Letter');
    await dialog.getByRole('button', { name: 'Export icons' }).click();
    await page.getByRole('menuitem', { name: /Put the icon in my app/ }).click();
    const confirm = dialog.getByTestId('app-icon-project-confirm');
    // The buttons sit in the bar under the panel, always in view.
    await dialog.getByRole('button', { name: 'Replace the icon' }).click();
    const call = await tauri.waitForCall('abs_write_export_files', 30_000);
    // The Android files replace other files of the same resource, such as an old .webp.
    expect(call.args.replaceResources).toEqual(['android/app/src/main/res']);
    expect((call.args.files as { path: string }[]).some((file) => file.path === 'android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml')).toBe(true);
    await expect(page.getByText('New icon added, but some old files are still there').first()).toBeVisible();
    await expect(page.getByText(/android\/app\/src\/main\/res\/mipmap-hdpi\/ic_launcher\.webp$/).first()).toBeVisible();
  });
});
