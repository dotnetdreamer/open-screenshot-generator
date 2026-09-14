import { test, expect, type Page } from '../fixtures/test';
import { canvasBottomBarsOverlap } from '../helpers/canvas';
import { readAll, readProjects, waitForProject, type StoredProject } from '../fixtures/db';

/**
 * The right dock's two backwards-looking tabs.
 *
 * They answer neighbouring questions and the difference between them is the
 * whole point of these tests: History is one sitting and dies with the reload,
 * a Version survives one. AGENTS.md rule 28 says the undo stack is never
 * persisted, which is what issue #19 was about, so "reload and the stack is
 * fresh while the work is still there" is asserted here rather than assumed.
 */

/** A projectVersions row with its gzipped payload dropped. */
interface StoredVersion {
  id: string;
  projectId: string;
  label: string;
  kind: 'named' | 'auto' | 'safety';
  projectName: string;
  boards: number;
  bytes: number;
}

/**
 * The right dock and the left palette both use Radix tabs and both keep an
 * active panel mounted at the same time, so a panel is identified by the header
 * only it has rather than by position.
 */
function historyPanel(page: Page) {
  return page
    .locator('[role="tabpanel"][data-state="active"]')
    .filter({ has: page.getByText('States', { exact: true }) });
}

function versionsPanel(page: Page) {
  return page
    .locator('[role="tabpanel"][data-state="active"]')
    .filter({ has: page.getByText('Versions', { exact: true }) });
}

/** The "N of M" counter in the History header. */
function historyCounter(page: Page) {
  return historyPanel(page).getByText(/^\d+ of \d+$/);
}

/**
 * The toolbar's Redo.
 *
 * Not Editor.redoButton: that is `getByTitle(/^Redo/)`, and the moment a step
 * back leaves states ahead of the current one the History panel paints rows
 * titled `Redo up to "..."`, so the shared locator stops being strict-mode
 * safe. The toolbar's own title always carries its shortcut.
 */
function toolbarRedo(page: Page) {
  return page.getByTitle(/^Redo \(/);
}

/** One row of the Versions list, found by the label it was saved under. */
function versionRow(page: Page, label: string) {
  return versionsPanel(page).locator('li').filter({ hasText: label });
}

/** How many elements the persisted project row is carrying, across all boards. */
function storedElementCount(project: StoredProject): number {
  const boards = project.projectData as Array<{ elements?: unknown[] }> | undefined;
  if (!Array.isArray(boards)) return 0;
  return boards.reduce((total, board) => total + (board.elements?.length ?? 0), 0);
}

/**
 * The Blob on a version row is not serializable out of the page, so the read
 * drops it. Everything asserted here is metadata anyway.
 */
async function readVersions(page: Page): Promise<StoredVersion[]> {
  const rows = await readAll<StoredVersion & { doc?: unknown }>(page, 'projectVersions');
  return rows.map(({ doc: _doc, ...meta }) => meta);
}

/**
 * Whether this browser can put a Blob into IndexedDB at all.
 *
 * A version's document is stored as a Blob (lib/versions/store.ts packs the
 * JSON with CompressionStream), and WebKit keeps IDB blobs as files beside the
 * database. Playwright's WebKit runs on an ephemeral data store with nowhere to
 * put them, so every such write fails with "Error preparing Blob/File data to
 * be stored in object store" and the whole feature is unwritable there. A real
 * Safari, and the WKWebView a desktop release ships in, both have a profile on
 * disk and store it fine.
 *
 * Probed rather than assumed from the platform: this is a property of the
 * browser under test, not of web versus desktop, and the desktop-chromium
 * project (Windows WebView2 parity) does run these.
 */
function canStoreBlobsInIndexedDb(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const name = 'e2e-blob-probe';
        const finish = (value: boolean, db?: IDBDatabase) => {
          db?.close();
          indexedDB.deleteDatabase(name);
          resolve(value);
        };
        const open = indexedDB.open(name, 1);
        open.onerror = () => finish(false);
        open.onupgradeneeded = () => open.result.createObjectStore('probe');
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('probe', 'readwrite');
          try {
            tx.objectStore('probe').put(new Blob(['probe']), 'key');
          } catch {
            finish(false, db);
            return;
          }
          tx.oncomplete = () => finish(true, db);
          tx.onerror = () => finish(false, db);
          tx.onabort = () => finish(false, db);
        };
      })
  );
}

/** Name a version through the panel's inline input, the way a person does. */
async function saveNamedVersion(page: Page, label: string): Promise<void> {
  await versionsPanel(page).getByRole('button', { name: 'Save this state' }).click();
  const input = versionsPanel(page).getByPlaceholder('Name this version');
  await expect(input).toBeVisible();
  await input.fill(label);
  await input.press('Enter');
  await expect(versionRow(page, label)).toHaveCount(1);
}

test.describe('history panel', () => {
  test('a freshly opened project starts on a single Open state', async ({ app, page }) => {
    await app.startBlankProject();
    await app.dockTab('History').click();

    // The blank path really does create a project ("Blank Canvas Copy"), so the
    // opening state is Open, not New Document: the latter is only ever the
    // placeholder before anything has been loaded.
    await expect(historyCounter(page)).toHaveText('1 of 1');
    const current = historyPanel(page).getByTitle('Current state');
    await expect(current).toHaveCount(1);
    await expect(current).toContainText('Open');
    await expect(current).toContainText('Blank Canvas Copy');
    await expect(historyPanel(page).getByText('Click any state to jump back to it')).toBeVisible();
  });

  test('each edit pushes a state named after what changed', async ({ app, page }) => {
    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await app.addElementFrom('Basic', 'Text', 'basic:text');

    await app.dockTab('History').click();
    await expect(historyCounter(page)).toHaveText('2 of 2');
    await expect(historyPanel(page).getByTitle('Current state')).toContainText('Add Element');

    // A text edit commits on blur, and its label is recovered by diffing the two
    // snapshots rather than passed in, so this is historyLabels.ts under test.
    await app.dockTab('Properties').click();
    await app.textContentInput.fill('Ship it');
    await app.textContentInput.blur();

    await app.dockTab('History').click();
    await expect(historyCounter(page)).toHaveText('3 of 3');
    const current = historyPanel(page).getByTitle('Current state');
    await expect(current).toContainText('Edit Text');
    // The detail column carries the layer's display name, which for a text
    // layer is its own content.
    await expect(current).toContainText('Ship it');
  });

  test('stepping back to a state puts that state back on the canvas', async ({ app, page }) => {
    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await app.addElementFrom('Basic', 'Text', 'basic:text');
    await app.addElement('Rectangle', 'basic:rectangle');
    await expect(app.elementsOn(0)).toHaveCount(2);

    await app.dockTab('History').click();
    await expect(historyCounter(page)).toHaveText('3 of 3');

    await historyPanel(page).getByTitle('Step back to "Open"').click();

    // The canvas, not just the panel: an empty board is what "Open" restores.
    await expect(app.elementsOn(0)).toHaveCount(0);
    await expect(historyCounter(page)).toHaveText('1 of 3');
    await expect(historyPanel(page).getByTitle('Current state')).toContainText('Open');
    // The states ahead stay listed and stay reachable, Photoshop style.
    await expect(
      historyPanel(page).getByText('2 states ahead will be dropped by your next edit.')
    ).toBeVisible();

    const redoRows = historyPanel(page).getByTitle('Redo up to "Add Element"');
    await expect(redoRows).toHaveCount(2);
    await redoRows.last().click();
    await expect(app.elementsOn(0)).toHaveCount(2);
    await expect(historyCounter(page)).toHaveText('3 of 3');
  });

  test('the toolbar undo moves the same pointer the panel shows', async ({ app, page }) => {
    await app.startBlankProject();
    await app.ensurePaletteOpen();
    // The canvas tool bar and the zoom pill overlap below about 1280px, which
    // leaves these controls covered. responsive.spec.ts owns that defect; a
    // second red mark for it here would only make the report harder to read.
    test.skip(
      await canvasBottomBarsOverlap(page),
      'the zoom pill covers the canvas tool bar at this width, see responsive.spec.ts'
    );
    await app.addElementFrom('Basic', 'Text', 'basic:text');
    await app.addElement('Rectangle', 'basic:rectangle');

    await app.dockTab('History').click();
    await expect(historyCounter(page)).toHaveText('3 of 3');

    // Undo, redo and a click on a row are one code path (applyHistoryIndex), so
    // the panel is the readout for the toolbar as much as for itself.
    await app.undoButton.click();
    await expect(historyCounter(page)).toHaveText('2 of 3');
    await expect(app.elementsOn(0)).toHaveCount(1);

    await toolbarRedo(page).click();
    await expect(historyCounter(page)).toHaveText('3 of 3');
    await expect(app.elementsOn(0)).toHaveCount(2);
  });

  test('the next edit after a step back drops the states ahead', async ({ app, page }) => {
    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await app.addElementFrom('Basic', 'Text', 'basic:text');
    await app.addElement('Rectangle', 'basic:rectangle');

    await app.dockTab('History').click();
    await historyPanel(page).getByTitle('Step back to "Open"').click();
    await expect(historyCounter(page)).toHaveText('1 of 3');

    await app.addElement('Circle', 'basic:circle');

    // One state on top of "Open", and the two that were ahead are gone: the
    // stack is a line, not a tree.
    await expect(historyCounter(page)).toHaveText('2 of 2');
    await expect(app.elementsOn(0)).toHaveCount(1);
    await expect(historyPanel(page).getByTitle(/^Redo up to/)).toHaveCount(0);
  });

  test('the undo stack does not survive a reload, and the work does', async ({ app, page }) => {
    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await app.addElementFrom('Basic', 'Text', 'basic:text');
    await app.addElement('Rectangle', 'basic:rectangle');
    await app.addElement('Circle', 'basic:circle');

    await app.dockTab('History').click();
    await expect(historyCounter(page)).toHaveText('4 of 4');

    // Saving is debounced, so the reload has to wait for the row rather than
    // race it.
    await waitForProject(page, (project) => storedElementCount(project) === 3);

    // A reload, not a fresh context: the URL carries ?projectId=, so the same
    // project comes back rather than the start dialog.
    await page.reload();
    await app.waitForBoot();

    // AGENTS.md rule 28 / issue #19: a hundred whole-project snapshots are never
    // written to disk, so a reload is always a fresh stack.
    await app.dockTab('History').click();
    await expect(historyCounter(page)).toHaveText('1 of 1');
    await expect(historyPanel(page).getByTitle('Current state')).toContainText('Open');
    await expect(historyPanel(page).getByTitle(/^Step back to/)).toHaveCount(0);

    // The project itself is untouched by that.
    await expect(app.elementsOn(0)).toHaveCount(3);
  });
});

test.describe('versions panel', () => {
  // Through `app` rather than `page`: the probe needs a real origin, and the
  // app fixture is what has navigated to one.
  test.beforeEach(async ({ app }) => {
    test.skip(
      !(await canStoreBlobsInIndexedDb(app.page)),
      'this browser cannot put a Blob in IndexedDB, and a version IS a Blob'
    );
  });

  test('Save this state keeps a named version in Dexie and lists it', async ({ app, page }) => {
    await app.startBlankProject();
    await app.dockTab('Versions').click();
    await expect(versionsPanel(page).getByText('None yet.', { exact: false })).toBeVisible();

    await saveNamedVersion(page, 'Launch cut');

    const rows = await readVersions(page);
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe('Launch cut');
    expect(rows[0].kind).toBe('named');
    expect(rows[0].boards).toBe(1);
    expect(rows[0].projectName).toBe('Blank Canvas Copy');
    // Named versions are the ones thinVersions must never reclaim, so the row
    // has to be tied to the project it came from.
    const [project] = await readProjects(page);
    expect(rows[0].projectId).toBe(project.id);
  });

  test('the first edit of a session checkpoints the state it started in', async ({ app, page }) => {
    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await app.addElementFrom('Basic', 'Text', 'basic:text');

    await app.dockTab('Versions').click();
    // Written from the commit door on the first edit, and it holds the boards as
    // they were BEFORE that edit, which is what makes it worth keeping.
    await expect(versionRow(page, 'Before this session')).toHaveCount(1);
    await expect.poll(async () => (await readVersions(page)).length).toBe(1);
    const [row] = await readVersions(page);
    expect(row.kind).toBe('auto');
    expect(row.label).toBe('Before this session');
  });

  test('restoring a version puts it on the canvas and is itself undoable', async ({ app, page }) => {
    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await app.addElementFrom('Basic', 'Text', 'basic:text');
    await expect(app.elementsOn(0)).toHaveCount(1);

    await app.dockTab('Versions').click();
    await saveNamedVersion(page, 'Just the headline');

    await app.addElement('Rectangle', 'basic:rectangle');
    await expect(app.elementsOn(0)).toHaveCount(2);

    await versionRow(page, 'Just the headline')
      .getByTitle('Put this state back on the canvas')
      .click();

    await expect(app.elementsOn(0)).toHaveCount(1);
    // A safety copy of what was on the canvas is taken first, so a restore is
    // never a one-way door.
    await expect(versionRow(page, 'Before restore')).toHaveCount(1);

    // The restore goes through the ordinary commit door, which is what makes it
    // an undoable edit rather than a mode of its own.
    await app.dockTab('History').click();
    await expect(historyPanel(page).getByTitle('Current state')).toContainText('Restore version');
    await expect(historyCounter(page)).toHaveText('4 of 4');
    await app.undoButton.click();
    await expect(app.elementsOn(0)).toHaveCount(2);
  });

  test('Delete this version removes the row and the Dexie record', async ({ app, page }) => {
    await app.startBlankProject();
    await app.dockTab('Versions').click();
    await saveNamedVersion(page, 'Keep me');
    await saveNamedVersion(page, 'Throw me away');
    await expect(versionsPanel(page).locator('li')).toHaveCount(2);

    await versionRow(page, 'Throw me away').getByTitle('Delete this version').click();

    await expect(versionRow(page, 'Throw me away')).toHaveCount(0);
    await expect(versionRow(page, 'Keep me')).toHaveCount(1);
    const rows = await readVersions(page);
    expect(rows.map((row) => row.label)).toEqual(['Keep me']);
  });

  test('a version can be opened as a project of its own', async ({ app, page }) => {
    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await app.addElementFrom('Basic', 'Text', 'basic:text');

    await app.dockTab('Versions').click();
    await saveNamedVersion(page, 'Variant A');

    const before = await readProjects(page);
    expect(before).toHaveLength(1);

    await versionRow(page, 'Variant A')
      .getByTitle('Open this state as a separate project')
      .click();

    // One template becomes two: the original row is untouched and a second one
    // appears, named after the version it came from.
    await expect.poll(async () => (await readProjects(page)).length).toBe(2);
    const after = await readProjects(page);
    const copy = after.find((project) => project.id !== before[0].id) as StoredProject;
    expect(copy.name).toBe('Blank Canvas Copy (Variant A)');
    expect(storedElementCount(copy)).toBe(1);

    // The copy is what is open now, so its history starts over at Open.
    await app.dockTab('History').click();
    await expect(historyCounter(page)).toHaveText('1 of 1');
    await expect(historyPanel(page).getByTitle('Current state')).toContainText('Variant A');
    await expect(app.elementsOn(0)).toHaveCount(1);
  });
});
