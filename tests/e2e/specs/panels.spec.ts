import { test, expect } from '../fixtures/test';
import { readProjects, put, waitForProject, type StoredProject } from '../fixtures/db';
import { Editor } from '../helpers/editor';

/**
 * The right dock, and the window it can leave the editor in.
 *
 * Two things here are load bearing and invisible from the outside:
 *
 *  - AGENTS.md rule 16. Radix leaves the tabpanel ELEMENT in the DOM when its
 *    tab is not selected (hidden, data-state="inactive") and unmounts only its
 *    children, and the palette is a second Tabs root, so the document holds two
 *    active panels at once. Anything reading a panel has to say which.
 *  - AGENTS.md rule 29. A detached panel window loads the same bundle at
 *    `?panel=...`, renders a snapshot it was sent and answers with an intent.
 *    The editor stays the only writer.
 */

/** localStorage keys the dock owns. Read straight, so a rename shows up here. */
const DOCK_OPEN_KEY = 'abs-right-dock-open';
const DOCK_TAB_KEY = 'abs-right-dock-tab';
/** A detached window keeps its own tab, never the dock's. */
const PANEL_TAB_KEY = 'abs-panel-window-tab-dock';

function readLocalStorage(page: import('@playwright/test').Page, key: string): Promise<string | null> {
  return page.evaluate((name) => window.localStorage.getItem(name), key);
}

/**
 * The dock panel a tab drives, whether or not it is the visible one.
 *
 * By `aria-controls` rather than by role: an inactive panel carries `hidden`,
 * which takes it out of the accessibility tree and out of getByRole's reach,
 * and it is precisely the inactive one these tests need to look at.
 */
async function panelFor(app: Editor, tab: 'Properties' | 'History' | 'Versions') {
  const id = await app.dockTab(tab).getAttribute('aria-controls');
  expect(id, `the ${tab} tab should name the panel it controls`).toBeTruthy();
  return app.page.locator(`[id="${id}"]`);
}

test.describe('right dock', () => {
  test('the tab you pick switches the panel and comes back after a reload', async ({ app, page }) => {
    await app.startBlankProject();
    // Reloading before the debounced save has landed would put the app back on
    // the empty-database branch, which is a different test.
    await waitForProject(page, () => true);

    await expect(app.activeDockPanel).toContainText('Artboard Background');

    await app.dockTab('History').click();
    await expect(app.activeDockPanel).toContainText('States');
    expect(await readLocalStorage(page, DOCK_TAB_KEY)).toBe('history');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await app.waitForBoot();

    await expect(app.dockTab('History')).toHaveAttribute('aria-selected', 'true');
    await expect(app.activeDockPanel).toContainText('States');
  });

  test('collapsing the dock gives its width back, and the rail reopens it on a chosen tab', async ({ app, page }) => {
    await app.startBlankProject();
    await waitForProject(page, () => true);

    await page.getByTitle('Collapse right panel').click();
    // The collapsed dock does not merely hide: RightDockPanels goes, which is
    // what hands the column back to the canvas.
    await expect(app.dockTab('Properties')).toHaveCount(0);
    await expect(page.getByTitle('Expand right panel')).toBeVisible();
    expect(await readLocalStorage(page, DOCK_OPEN_KEY)).toBe('0');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await app.waitForBoot();
    await expect(page.getByTitle('Expand right panel')).toBeVisible();
    await expect(app.dockTab('Properties')).toHaveCount(0);

    // A rail label opens the dock ON that tab, rather than on whatever was last
    // shown, which is the only reason the rail lists four of them.
    await page.getByTitle('Open Versions').click();
    await expect(app.dockTab('Versions')).toHaveAttribute('aria-selected', 'true');
    await expect(app.activeDockPanel).toContainText('Save this state');
    expect(await readLocalStorage(page, DOCK_OPEN_KEY)).toBe('1');
  });

  test('an inactive panel keeps its element in the DOM, so a panel query has to say which panel', async ({ app, page }) => {
    await app.startBlankProject();

    const properties = await panelFor(app, 'Properties');
    const history = await panelFor(app, 'History');

    await expect(properties).toHaveAttribute('data-state', 'active');
    // Still there, still queryable, and holding nothing. A querySelector that
    // does not filter on data-state can land on this one.
    await expect(history).toHaveCount(1);
    await expect(history).toHaveAttribute('data-state', 'inactive');
    await expect(history).toBeHidden();

    // Two roots, two active panels: the palette on the left and the dock on the
    // right. This is why Editor.activeDockPanel takes the last.
    await expect(page.locator('[role="tabpanel"][data-state="active"]')).toHaveCount(2);

    await app.dockTab('History').click();
    await expect(history).toHaveAttribute('data-state', 'active');
    await expect(properties).toHaveAttribute('data-state', 'inactive');
    await expect(properties).toBeHidden();
    await expect(page.locator('[role="tabpanel"][data-state="active"]')).toHaveCount(2);
  });

  test('the panel menu offers a window per panel, and no display neither host can name', async ({ app, page, isDesktop }) => {
    await app.startBlankProject();
    await page.getByTitle('Panel and display options').click();

    const expected = ['open all panels in a window', 'properties', 'history', 'versions', 'layers'];
    // Chromium can be asked for the Window Management permission; WebKit and
    // the desktop shell cannot, and the desktop does not need to.
    const canAskForDisplays = !isDesktop && (await page.evaluate(() => 'getScreenDetails' in window));
    if (canAskForDisplays) expected.push('let this page see my other displays');

    const items = (await page.getByRole('menuitem').allInnerTexts()).map((text) =>
      text.trim().toLowerCase()
    );
    expect(items).toEqual(expected);

    // The desktop mock reports no monitors and the web sees one screen, so
    // neither may offer a picker. A single entry that moves nothing is worse
    // than no entry at all.
    await expect(page.getByText('Move the editor to a display')).toHaveCount(0);
    await expect(page.getByText('Move to display')).toHaveCount(0);
  });
});

test.describe('detached panel window', () => {
  test('the dock leaves the editor for a window of its own, and the editor takes it back', async ({
    app,
    page,
    tauri,
    isDesktop,
  }) => {
    await app.startBlankProject();

    // A web popup and a Tauri WebviewWindow are the same act through two
    // shells, so the click is shared and only the evidence differs.
    const popupPromise = isDesktop ? null : page.waitForEvent('popup');
    await app.chooseFromMenu(
      page.getByTitle('Panel and display options'),
      'Open all panels in a window'
    );

    if (isDesktop) {
      const call = await tauri.waitForCall('plugin:webview|create_webview_window');
      const options = (call.args as { options?: { label?: string; url?: string } }).options ?? {};
      // The label is what capabilities/panels.json matches, and the query is
      // what the head boot script reads before the first paint.
      expect(options.label).toBe('panel-dock');
      expect(options.url).toContain('panel=dock');
      expect(options.url).toContain('host=');
    } else {
      const popup = await popupPromise!;
      expect(popup.url()).toContain('panel=dock');
      expect(popup.url()).toContain('host=');
      await popup.close();
    }

    // The dock does not just grey out: its panels are showing somewhere else,
    // so it collapses to a rail and stops rendering a second copy of them.
    await expect(app.dockTab('Properties')).toHaveCount(0);
    await expect(page.getByTitle('Bring the panel window forward')).toBeVisible();
    const putBack = page.getByTitle('Close the panel window and put the panels back here');
    await expect(putBack).toBeVisible();

    await putBack.click();
    await expect(app.dockTab('Properties')).toBeVisible();
    await expect(app.dockTab('History')).toBeVisible();
    await expect(app.dockTab('Versions')).toBeVisible();
    await expect(app.activeDockPanel).toContainText('Artboard Background');
  });

  test('a panel window renders panels, never an editor, and never writes the project', async ({
    page,
    tauri,
    isDesktop,
  }) => {
    // Deliberately the ONLY page in the context: with no editor anywhere, every
    // row in the database afterwards is one this window wrote.
    await page.goto('/?panel=dock', { waitUntil: 'domcontentloaded' });

    // Set blocking in <head> by PANEL_WINDOW_BOOT_SCRIPT, which is what stops
    // the exported editor skeleton flashing here.
    await expect(page.locator('html')).toHaveAttribute('data-osg-panel', '1');
    await expect(page.getByRole('button', { name: 'Put back in the editor' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Window options' })).toBeVisible();

    // No editor: no toolbar, no canvas, no palette.
    await expect(page.getByTitle('Export')).toHaveCount(0);
    await expect(page.getByTitle('Select Template')).toHaveCount(0);
    await expect(page.locator('[data-artboard-dom-id]')).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Elements', exact: true })).toHaveCount(0);

    // It gives up looking for an editor instead of becoming one.
    await expect(page.getByText('This window cannot find the editor')).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();

    // Rule 29, first half: an editor booting on an empty database always ends
    // up with a project row. A panel window creates none.
    expect(await readProjects(page)).toEqual([]);

    // Rule 29, second half: nor does it touch one that is already there. The
    // panel window has opened Dexie by now (it reads the imported fonts), so
    // the schema exists and this row goes into the real table.
    const seeded: StoredProject = {
      id: 'panel-rule-29',
      name: 'Untouched By Panels',
      timestamp: 1_700_000_000_000,
      projectData: { artboards: [] },
    };
    await put(page, 'projects', seeded);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText('This window cannot find the editor')).toBeVisible({
      timeout: 30_000,
    });
    expect(await readProjects(page)).toEqual([seeded]);

    if (isDesktop) {
      // A panel window that reached for a command the shell does not have would
      // be a real gap, not test noise.
      expect(await tauri.unhandled()).toEqual([]);
    }
  });

  test('the projection carries the properties form, and an edit made in it lands on the editor canvas', async ({
    app,
    page,
    isDesktop,
  }) => {
    test.skip(
      isDesktop,
      'the desktop build opens a real OS window through Tauri rather than a browser popup, so there is no second page for a test to drive. The IPC it sends is covered by the desktop test below.'
    );

    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await app.addElementFrom('Basic', 'Text', 'basic:text');

    // What the docked form shows, captured before the dock gives it away.
    const dockedContent = await app.textContentInput.inputValue();
    const dockedFontSize = await app.fontSizeInput.inputValue();
    expect(dockedContent.length).toBeGreaterThan(0);

    const popupPromise = page.waitForEvent('popup');
    await app.chooseFromMenu(
      page.getByTitle('Panel and display options'),
      'Open all panels in a window'
    );
    const panel = await popupPromise;
    const panelEditor = new Editor(panel);

    await expect(panelEditor.dockTab('Properties')).toBeVisible({ timeout: 30_000 });

    // toWireSnapshot elides bytes, not fields. Every one of these is a field the
    // projection would drop silently if someone slimmed too far.
    await expect(panelEditor.textContentInput).toHaveValue(dockedContent);
    await expect(panelEditor.fontSizeInput).toHaveValue(dockedFontSize);
    await expect(panel.getByText('basic:text')).toBeVisible();
    await expect(panelEditor.layersHeader).toContainText('Layers:');

    // The tab lives per window: a detached window must not rewrite the dock's.
    await panelEditor.dockTab('History').click();
    await expect(panelEditor.activeDockPanel).toContainText('Add Element');
    expect(await readLocalStorage(panel, PANEL_TAB_KEY)).toBe('history');
    expect(await readLocalStorage(page, DOCK_TAB_KEY)).not.toBe('history');
    await panelEditor.dockTab('Properties').click();

    // The round trip: intent out of the panel window, replayed by the editor
    // against the same handler the docked panel calls. Content commits on blur.
    await panelEditor.textContentInput.fill('Detached edit');
    await panelEditor.textContentInput.blur();

    const canvasText = app.elementsOn(0).locator('[data-text-body="true"]').first();
    await expect(canvasText).toHaveText('Detached edit');

    await panelEditor.fontSizeInput.fill('72');
    await panelEditor.fontSizeInput.blur();
    // AGENTS.md rule 3: text renders at fontSize / 0.3 px. 72 is 240px, and it
    // got there from another window.
    await expect(canvasText).toHaveCSS('font-size', '240px');

    // The editor is the writer, so the edit is in the editor's database.
    await waitForProject(page, (project) =>
      JSON.stringify(project.projectData).includes('Detached edit')
    );

    // "Put back" from the panel window: it closes itself and the dock reclaims
    // the panels, with the edit it made still in the form.
    await panel.getByRole('button', { name: 'Put back in the editor' }).click();
    await expect.poll(() => panel.isClosed(), { timeout: 20_000 }).toBe(true);
    await expect(app.dockTab('Properties')).toBeVisible();
    await expect(app.textContentInput).toHaveValue('Detached edit');
  });

  test('on desktop the same menu asks Tauri for a real window, with the panel URL and its own label', async ({
    app,
    page,
    tauri,
    isDesktop,
  }) => {
    test.skip(!isDesktop, 'the web build opens a popup instead, which the test above drives directly');

    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await app.addElementFrom('Basic', 'Text', 'basic:text');

    await app.chooseFromMenu(
      page.getByTitle('Panel and display options'),
      'Open all panels in a window'
    );

    // A real OS window is the one thing a browser cannot be talked into, so
    // what is assertable here is the request. It is also where every detail
    // that matters is decided: get the URL wrong and the window loads the whole
    // editor a second time, which rule 29 says must never happen because the
    // editor is the only writer.
    // WebviewWindow makes a window and its webview in one call, so the command
    // is create_webview_window rather than the bare create_webview.
    const created = await tauri.waitForCall('plugin:webview|create_webview_window', 30_000);
    const options = (created.args as { options?: Record<string, unknown> }).options ?? {};

    expect(String(options.url)).toContain('panel=dock');
    // The host id is how a panel window knows which editor to answer.
    expect(String(options.url)).toContain('host=');
    // Created hidden, then placed, then shown: a window that appears on the
    // wrong display and jumps reads as a bug (src/lib/panels/windows.ts).
    expect(options.visible).toBe(false);
    // Tauri swallows web drag and drop wherever this is on, and the canvas is
    // the only place a dropped file means anything.
    expect(options.dragDropEnabled).toBe(false);

    // Placed and shown only after it exists, under the label the rest of the
    // feature addresses it by.
    const shown = await tauri.waitForCall('plugin:window|show', 20_000);
    expect((shown.args as { label?: string }).label).toBe('panel-dock');

    // No command in the whole flow fell outside what the runtime models.
    expect(await tauri.unhandled()).toEqual([]);
  });
});
