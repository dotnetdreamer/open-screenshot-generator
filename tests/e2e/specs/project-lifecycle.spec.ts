import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect, type Page } from '../fixtures/test';
import { expectBoardSize } from '../helpers/canvas';
import { readProjects, waitForProject, put, type StoredProject } from '../fixtures/db';
import { Editor } from '../helpers/editor';

/**
 * The project lifecycle: created, persisted, reopened, renamed, and moved in
 * and out of a .json file on disk.
 *
 * What makes this surface worth its own spec is that NONE of it is one
 * component's business. A project is a Dexie row, a `?projectId` in the URL,
 * a debounced writer, and two file paths that fork on `isTauri()`. A break in
 * any one of them looks the same to the user (their work is gone) and to a
 * unit test (nothing).
 */

// The app writes `timestamp` as a Date (Project in src/types/artboard.ts), and
// the start dialog calls `.toLocaleString()` on it. The shared StoredProject
// types it as a number, so a seeded row is built through this shape instead of
// lying to the fixture.
interface SeedProject {
  id: string;
  name: string;
  timestamp: Date;
  projectData: unknown[];
}

/** A one-board project with a single rectangle, at a size nothing else uses. */
function seedProject(id: string, name: string): SeedProject {
  return {
    id,
    name,
    timestamp: new Date('2024-05-04T10:00:00.000Z'),
    projectData: [
      {
        id: 'artboard_seeded_1',
        name: 'Seeded Artboard',
        // 1024x500 is the Play Store feature graphic, and deliberately NOT the
        // 1290x2796 default: a board of this size on screen can only have come
        // out of the seeded row.
        size: { width: 1024, height: 500 },
        backgroundColor: '#FFFFFF',
        zoom: 1,
        position: { x: 50, y: 50 },
        elements: [
          {
            id: 'el_seeded_rect',
            type: 'shape',
            shapeType: 'rectangle',
            name: 'Seeded Rectangle',
            position: { x: 100, y: 120 },
            size: { width: 400, height: 200 },
            rotation: 0,
            scale: 1,
            fillColor: '#2563EB',
            strokeColor: '#000000',
            strokeWidth: 0,
          },
        ],
      },
    ],
  };
}

/**
 * A toast, by its title.
 *
 * Every toast is rendered twice: once visibly, and once inside the aria-live
 * region the Radix viewport keeps for screen readers. `.first()` takes the
 * visible one; without it every toast assertion is a strict-mode violation.
 */
function toast(page: Page, text: string | RegExp) {
  return page.getByText(text).first();
}

/**
 * Wait until Dexie has created the `projects` store.
 *
 * Seeding a row is only possible once the app has opened the database, because
 * the app owns the schema. Polling for the store is what makes "seed, then
 * reload" deterministic rather than a race with boot.
 */
async function waitForProjectStore(page: Page): Promise<void> {
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
}

/**
 * Toolbar Export, then "Project file .json".
 *
 * Not a bare `chooseFromMenu`, because the cancel test below opens this menu
 * twice: Radix parks `pointer-events: none` on <body> for as long as a modal
 * menu is up and clears it only once the close has finished, so a second click
 * that lands inside that window is swallowed and the menu never reopens. The
 * trigger's own data-state goes back to "closed" before that, which is why it
 * is the body style being waited on and not the button.
 */
async function exportProjectFile(editor: Editor): Promise<void> {
  await expect(editor.page.locator('[role="menu"]')).toHaveCount(0);
  await expect
    .poll(() => editor.page.evaluate(() => document.body.style.pointerEvents))
    .toBe('');
  await editor.chooseFromMenu(editor.exportButton, /Project file/i);
}

/** The floating pill bottom-left, and the input its double-click reveals. */
function nameField(editor: Editor) {
  return editor.page.getByTitle('Double-click to rename project');
}

/** Rename the open project the way a user does: double-click, type, Enter. */
async function renameProject(editor: Editor, name: string): Promise<void> {
  await nameField(editor).dblclick();
  const input = editor.page.getByPlaceholder('Project name...');
  await expect(input).toBeVisible();
  await input.fill(name);
  await input.press('Enter');
  await expect(nameField(editor)).toContainText(name);
}

/** The project row the editor has committed, whatever it holds. */
async function committedProject(editor: Editor): Promise<StoredProject> {
  return waitForProject(editor.page, (project) => Array.isArray(project.projectData));
}

test.describe('a project persists', () => {
  test('a blank project with an element is written to Dexie and survives a reload', async ({ app, page }) => {
    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await app.addElementFrom('Basic', 'Text', 'basic:text');

    // Give the element a value nothing else on the canvas could produce, so
    // "it came back" cannot be satisfied by a fresh blank project.
    // PropertiesPanel commits the textarea on BLUR, not on every keystroke
    // (handleTextContentBlur), so a test that only types is testing nothing.
    await app.textContentInput.fill('Persisted headline');
    await app.textContentInput.blur();
    await app.fontSizeInput.fill('48');
    await app.fontSizeInput.blur();

    const stored = await waitForProject(page, (project) =>
      JSON.stringify(project.projectData).includes('Persisted headline')
    );
    expect(stored.name).toBeTruthy();

    // The editor mirrors the open project into ?projectId, which is the only
    // reason a refresh reopens it rather than showing the start dialog.
    expect(page.url()).toContain(`projectId=${stored.id}`);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await app.waitForBoot();

    await expect(app.artboards).toHaveCount(1);
    await expectBoardSize(app.board(0), 1290, 2796);
    await expect(app.elementsOn(0)).toHaveCount(1);
    await expect(app.board(0).locator('[data-text-body="true"]')).toHaveText('Persisted headline');
    // AGENTS.md rule 3: text renders at fontSize / 0.3, so a 48pt headline is
    // 160px on screen. It surviving the reload proves the property round
    // tripped, not just the string.
    await expect(app.board(0).locator('[data-text-body="true"]')).toHaveCSS('font-size', '160px');
    // Still exactly one row: a reload must reopen the project, never fork it.
    expect(await readProjects(page)).toHaveLength(1);
  });

  test('a rename round-trips through the database and a reload', async ({ app, page }) => {
    await app.startBlankProject();
    await expect(nameField(app)).toBeVisible();

    await renameProject(app, 'Autumn Release Pass');
    const stored = await waitForProject(page, (project) => project.name === 'Autumn Release Pass');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await app.waitForBoot();

    await expect(nameField(app)).toContainText('Autumn Release Pass');
    expect(page.url()).toContain(`projectId=${stored.id}`);
  });

  test('an empty rename is refused rather than saved', async ({ app, page }) => {
    await app.startBlankProject();
    await renameProject(app, 'Keeps Its Name');
    await waitForProject(page, (project) => project.name === 'Keeps Its Name');

    // ProjectNameField ignores a blank draft on commit. If that guard goes, a
    // stray select-all-and-delete leaves an unfindable nameless project.
    await nameField(app).dblclick();
    const input = page.getByPlaceholder('Project name...');
    await expect(input).toBeVisible();
    await input.fill('   ');
    await input.press('Enter');

    await expect(nameField(app)).toContainText('Keeps Its Name');
    const rows = await readProjects(page);
    expect(rows.map((row) => row.name)).toEqual(['Keeps Its Name']);
  });
});

test.describe('a project reopens from the start dialog', () => {
  test('a saved project is listed under Recent projects and opens with its board', async ({ page }) => {
    // The database has to exist before a row can go into it, and only the app
    // creates it (Dexie owns the schema). So: boot once to get the stores,
    // seed, then come back to a bare '/' with no ?projectId, which is what a
    // returning user's first paint actually is.
    // The dialog is left OPEN on this first boot on purpose. Closing it with
    // an empty canvas makes the app create a blank project (the start dialog's
    // onOpenChange), which would put a second row in the database and make
    // "exactly one project" below meaningless.
    const editor = new Editor(page);
    await editor.goto();
    await expect(editor.startDialog).toBeVisible();
    await waitForProjectStore(page);

    const seeded = seedProject('proj_seeded_lifecycle', 'Feature Graphic Draft');
    await put(page, 'projects', seeded);
    expect(await readProjects(page)).toHaveLength(1);

    await editor.goto('/');
    await expect(editor.startDialog).toBeVisible();
    await expect(editor.startDialog.getByRole('heading', { name: 'Recent projects' })).toBeVisible();

    const entry = editor.startDialog.getByText('Feature Graphic Draft', { exact: true });
    await expect(entry).toBeVisible();
    await entry.click();

    await expect(editor.startDialog).toBeHidden();
    await expect(editor.artboards).toHaveCount(1);
    await expectBoardSize(editor.board(0), 1024, 500);
    await expect(editor.elementsOn(0)).toHaveCount(1);
    await expect(editor.board(0).locator('[data-element-id="el_seeded_rect"]')).toBeVisible();
    await expect(nameField(editor)).toContainText('Feature Graphic Draft');
    // Opening is not a modification: it must reuse the row, not clone it.
    expect(page.url()).toContain('projectId=proj_seeded_lifecycle');
    expect(await readProjects(page)).toHaveLength(1);
  });

  test('the Recent projects search narrows the list to a name', async ({ page }) => {
    const editor = new Editor(page);
    await editor.goto();
    await expect(editor.startDialog).toBeVisible();
    await waitForProjectStore(page);

    await put(page, 'projects', seedProject('proj_seed_alpha', 'Alpha Launch Set'));
    await put(page, 'projects', seedProject('proj_seed_beta', 'Beta Store Listing'));

    await editor.goto('/');
    await expect(editor.startDialog).toBeVisible();
    await expect(editor.startDialog.getByText('Alpha Launch Set', { exact: true })).toBeVisible();
    await expect(editor.startDialog.getByText('Beta Store Listing', { exact: true })).toBeVisible();

    await editor.startDialog.getByPlaceholder('Search projects...').fill('beta');
    await expect(editor.startDialog.getByText('Alpha Launch Set', { exact: true })).toBeHidden();
    await expect(editor.startDialog.getByText('Beta Store Listing', { exact: true })).toBeVisible();
  });
});

test.describe('a project moves out to a file', () => {
  test('Export -> Project file .json writes the open project', async ({ app, page, tauri, isDesktop }) => {
    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await app.addElementFrom('Basic', 'Text', 'basic:text');
    // Not 'Exported ...': the layer row's title is `Double-click to rename
    // "<label>"` and Editor.exportButton is getByTitle('Export'), which
    // matches by SUBSTRING, so a layer named after the button collides with it.
    await app.textContentInput.fill('Bundled headline');
    await app.textContentInput.blur();

    const stored = await waitForProject(page, (project) =>
      JSON.stringify(project.projectData).includes('Bundled headline')
    );

    if (isDesktop) {
      // WKWebView ignores <a download>, so desktop has to go through the
      // native dialog and the fs plugin. That fork is the whole reason
      // src/lib/desktop.ts exists, and this is what proves it is taken.
      await exportProjectFile(app);
      const dialog = await tauri.waitForCall('plugin:dialog|save');
      expect(dialog.cmd).toBe('plugin:dialog|save');

      const files = await tauri.waitForFiles(1);
      expect(files).toHaveLength(1);
      expect(files[0].via).toBe('plugin:fs|write_file');
      expect(files[0].path).toBe(`/tmp/osg-e2e/artboard-project-${stored.id}.json`);
      // A bundle carrying an artboard and a text element is not a few bytes.
      expect(files[0].bytes).toBeGreaterThan(200);
    } else {
      const downloadPromise = page.waitForEvent('download');
      await exportProjectFile(app);
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBe(`artboard-project-${stored.id}.json`);

      // Read it back: a download event alone does not prove the file holds the
      // project rather than an empty blob.
      const saved = await download.path();
      expect(saved).toBeTruthy();
      const parsed = JSON.parse(await fs.readFile(saved as string, 'utf8'));
      expect(parsed.id).toBe(stored.id);
      expect(parsed.projectData).toHaveLength(1);
      expect(parsed.projectData[0].size).toEqual({ width: 1290, height: 2796 });
      expect(JSON.stringify(parsed.projectData)).toContain('Bundled headline');
    }

    await expect(toast(page, 'Project Exported')).toBeVisible();
  });

  test('cancelling the native save dialog writes nothing', async ({ app, page, tauri, isDesktop }) => {
    test.skip(!isDesktop, 'there is no cancellable save dialog on the web: a download just happens');

    await app.startBlankProject();
    const stored = await waitForProject(page, (project) => !!project.id);

    // The user opens the dialog and presses Cancel.
    await tauri.setSavePath(null);
    await exportProjectFile(app);
    await tauri.waitForCall('plugin:dialog|save');
    expect(await tauri.files()).toEqual([]);
    await expect(toast(page, 'Project Exported')).toBeHidden();

    // The control, and the synchronisation for the assertion above: the SAME
    // flow with a path chosen does write. Without this half, "no file" could
    // just mean the export had not got there yet.
    await tauri.setSavePath('/tmp/osg-e2e/');
    await exportProjectFile(app);
    const files = await tauri.waitForFiles(1);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe(`/tmp/osg-e2e/artboard-project-${stored.id}.json`);
  });
});

test.describe('a project comes back in from a file', () => {
  test('Open a project -> From a project file .json restores the board and its elements', async ({ app, page }, testInfo) => {
    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await app.addElementFrom('Basic', 'Text', 'basic:text');
    await app.textContentInput.fill('Round trip headline');
    await app.textContentInput.blur();

    const stored = await waitForProject(page, (project) =>
      JSON.stringify(project.projectData).includes('Round trip headline')
    );

    // Build the file the way the app's own exporter does (bundleToJson spreads
    // the manifest at the top level), then change the parts an import has to
    // carry across, so nothing here can pass by accidentally still showing the
    // project that is already open.
    const projectData = JSON.parse(JSON.stringify(stored.projectData)) as Record<string, unknown>[];
    projectData[0].name = 'Imported Artboard';
    projectData[0].size = { width: 1024, height: 500 };
    const file = {
      formatVersion: 1,
      id: 'proj_on_disk',
      name: 'Project From Disk',
      timestamp: new Date('2024-05-04T10:00:00.000Z').toISOString(),
      projectData,
      media: [],
    };

    // testInfo.outputPath is per test AND per project, so the web and desktop
    // runs cannot collide over one file name.
    const onDisk = testInfo.outputPath('project-from-disk.json');
    await fs.mkdir(path.dirname(onDisk), { recursive: true });
    await fs.writeFile(onDisk, JSON.stringify(file, null, 2), 'utf8');

    // handleImportProjectFromJSON builds the <input type="file"> in JS and
    // removes it again in the same tick, so there is no locator to point
    // setInputFiles at. The chooser event is the real handle on it.
    const chooser = page.waitForEvent('filechooser');
    await app.chooseFromMenu(app.openProjectButton, /From a project file/i);
    await (await chooser).setFiles(onDisk);

    await expect(nameField(app)).toContainText('Project From Disk');
    await expect(app.artboards).toHaveCount(1);
    await expectBoardSize(app.board(0), 1024, 500);
    await expect(app.elementsOn(0)).toHaveCount(1);
    await expect(app.board(0).locator('[data-text-body="true"]')).toHaveText('Round trip headline');

    // An import must never overwrite the project it came from: importBundle
    // mints `imported_<ts>`, so the original row is still there beside it.
    const rows = await waitForProject(page, (project) => project.id.startsWith('imported_'));
    expect(rows.name).toBe('Project From Disk');
    const ids = (await readProjects(page)).map((row) => row.id);
    expect(ids).toContain(stored.id);
    expect(ids).toHaveLength(2);
    expect(page.url()).toContain(`projectId=${rows.id}`);
  });

  test('a file that is not a project is refused with a message, and the open project is untouched', async ({ app, page }, testInfo) => {
    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await app.addElementFrom('Basic', 'Text', 'basic:text');
    await app.textContentInput.fill('Still here');
    await app.textContentInput.blur();
    await waitForProject(page, (project) => JSON.stringify(project.projectData).includes('Still here'));

    const junk = testInfo.outputPath('not-a-project.json');
    await fs.mkdir(path.dirname(junk), { recursive: true });
    await fs.writeFile(junk, JSON.stringify({ hello: 'world' }), 'utf8');

    const chooser = page.waitForEvent('filechooser');
    await app.chooseFromMenu(app.openProjectButton, /From a project file/i);
    await (await chooser).setFiles(junk);

    // bundleFromJson's own wording. A bad file has to fail loudly and leave
    // the canvas alone, not blank it.
    await expect(toast(page, 'This file is missing its artboard data.')).toBeVisible();
    await expect(app.artboards).toHaveCount(1);
    await expectBoardSize(app.board(0), 1290, 2796);
    await expect(app.board(0).locator('[data-text-body="true"]')).toHaveText('Still here');
    expect(await readProjects(page)).toHaveLength(1);
  });
});

test.describe('the project file is an interchange format', () => {
  test('a hand-written project file the app never exported still imports', async ({ app, page }) => {
    await app.startBlankProject();
    const stored = await committedProject(app);

    // Nothing here came out of the app: this is the documented shape
    // (ProjectManifest, spread flat by bundleToJson) typed out by hand. If the
    // reader tightens beyond what the writer promises, this is what notices.
    const file = {
      formatVersion: 1,
      id: 'proj_handwritten',
      name: 'Hand Written Project',
      timestamp: new Date().toISOString(),
      projectData: seedProject('unused', 'unused').projectData,
      media: [],
    };
    const onDisk = path.join(
      await fs.mkdtemp(path.join(os.tmpdir(), 'osg-e2e-')),
      'hand-written-project.json'
    );
    await fs.writeFile(onDisk, JSON.stringify(file), 'utf8');

    const chooser = page.waitForEvent('filechooser');
    await app.chooseFromMenu(app.openProjectButton, /From a project file/i);
    await (await chooser).setFiles(onDisk);

    await expect(nameField(app)).toContainText('Hand Written Project');
    await expectBoardSize(app.board(0), 1024, 500);
    await expect(app.board(0).locator('[data-element-id="el_seeded_rect"]')).toBeVisible();
    expect(await readProjects(page)).toHaveLength(2);
    expect((await readProjects(page)).map((row) => row.id)).toContain(stored.id);
  });
});
