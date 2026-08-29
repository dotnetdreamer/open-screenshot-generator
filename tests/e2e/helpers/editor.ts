import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Page object for the editor.
 *
 * Locator policy, decided against the real DOM rather than guessed:
 *
 *  - Toolbar buttons are icon-only and carry `title`, not `aria-label`
 *    (Toolbar.tsx), so `getByTitle` is the exact locator. `getByRole` also
 *    resolves them, because `title` is the last fallback in the accessible
 *    name calculation, but only while the button stays text-free.
 *  - Palette CATEGORY tiles carry `title={`Browse ${label}`}` AND a visible
 *    label, so their accessible name is the visible text and `getByTitle` is
 *    the only unambiguous handle.
 *  - Palette ITEM tiles carry `aria-label={`Add ${label} (${libraryId})`}`,
 *    which is unique and stable because the library id is in it.
 *  - Artboards and elements expose real data attributes
 *    (`data-artboard-dom-id`, `data-element-id`), which is what the canvas
 *    assertions hang off.
 *  - Properties controls have ids (`#textContent`, `#fontSize`, ...).
 *
 * Radix keeps INACTIVE tab panels mounted, so anything read out of a panel is
 * scoped to `[role="tabpanel"][data-state="active"]`.
 */
export class Editor {
  constructor(readonly page: Page) {}

  // ---------------------------------------------------------------- booting

  /** Load the editor and wait until its chrome is interactive. */
  async goto(path = '/'): Promise<void> {
    await this.page.goto(path, { waitUntil: 'domcontentloaded' });
    await this.waitForBoot();
  }

  /**
   * The static HTML ships a skeleton, so "the document loaded" proves nothing.
   * The Export button only exists once the real toolbar has hydrated.
   *
   * Hydration is not the end of booting, though: the app then reads Dexie and
   * either opens the start dialog (no projects) or paints the last project.
   * Waiting for that decision is what stops a fast machine and a slow one
   * disagreeing about whether a modal is on screen.
   */
  async waitForBoot(): Promise<void> {
    await expect(this.exportButton).toBeVisible({ timeout: 60_000 });
    await this.page
      .locator('[role="dialog"], [data-artboard-dom-id]')
      .first()
      .waitFor({ state: 'visible', timeout: 60_000 });

    // If it went the start-dialog way, that dialog is not finished yet either.
    // Centralised here so no spec has to remember it.
    if (await this.startDialog.isVisible().catch(() => false)) {
      await this.waitForStartDialogReady();
    }
  }

  // ------------------------------------------------------------ start screen

  /** The "Start a new project" dialog, which opens on an empty database. */
  get startDialog(): Locator {
    return this.page.getByRole('dialog').filter({ hasText: /Start a new project|blank canvas/i });
  }

  /**
   * Wait until the start dialog actually has its catalogue.
   *
   * The app fetches all 101 template JSON files on boot just to fill in the
   * per-category counts, and until they land the tabs read a literal ellipsis
   * and the deck renders skeletons. Clicking through before then is not broken,
   * only queued behind that work, but with several browser contexts booting at
   * once they saturate the dev server and the queue outlasts a plain timeout.
   * Waiting for a numeric count is waiting for the dialog to mean what it says.
   */
  async waitForStartDialogReady(): Promise<void> {
    await expect(this.startDialog).toBeVisible({ timeout: 30_000 });
    await expect(
      this.startDialog.getByRole('tab', { name: /App Screenshots\s*\d+/ })
    ).toBeVisible({ timeout: 90_000 });
  }

  /** Take the blank-canvas path out of the start dialog. */
  async startBlankProject(): Promise<void> {
    await this.waitForStartDialogReady();
    const blank = this.page.getByRole('button', { name: /Start with a blank canvas/i }).first();
    await expect(blank).toBeVisible({ timeout: 30_000 });
    await blank.click();
    // Creating the project writes to Dexie before the dialog closes, so this is
    // waiting on real work, not on an animation.
    await expect(this.startDialog).toBeHidden({ timeout: 45_000 });
    await expect(this.artboards.first()).toBeVisible({ timeout: 45_000 });
  }

  /**
   * Close the start dialog.
   *
   * Closing it can create a blank project rather than leaving the editor
   * empty, but only under one condition: `onOpenChange` calls
   * `handleSelectTemplate(createBlankProject(...))` when
   * `artboards.length === 0 && availableProjects.length > 0`
   * (OpenScreenshotGeneratorLayout.tsx). So on the empty database a test
   * starts from, closing leaves the canvas bare; once a project exists on
   * disk, closing lands you on a fresh blank one.
   *
   * Use this when a test needs the chrome reachable and does not care what is
   * on the canvas. Use `startBlankProject()` when the project is the point.
   *
   * A no-op when the app opened straight into an existing project.
   */
  async dismissStartDialog(): Promise<void> {
    const opened = await this.startDialog
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    if (!opened) return;
    await this.page.keyboard.press('Escape');
    await expect(this.startDialog).toBeHidden({ timeout: 15_000 });
  }

  /**
   * Make sure the element palette is on screen.
   * Below the `lg` breakpoint it lives in a collapsible sidebar behind a
   * trigger, so a narrow viewport has to open it first.
   */
  async ensurePaletteOpen(): Promise<void> {
    if (await this.paletteTab('Elements').isVisible().catch(() => false)) return;
    const trigger = this.page.getByTitle('Open elements palette');
    if (await trigger.count()) await trigger.first().click();
    await expect(this.paletteTab('Elements')).toBeVisible({ timeout: 15_000 });
  }

  // ---------------------------------------------------------------- toolbar

  get selectTemplateButton(): Locator { return this.page.getByTitle('Select Template'); }
  get screenshotsButton(): Locator { return this.page.getByTitle('Start from screenshots'); }
  get canvasSizeButton(): Locator { return this.page.getByTitle(/^Canvas size:/); }
  get previewButton(): Locator { return this.page.getByTitle('Preview the project'); }
  get openProjectButton(): Locator { return this.page.getByTitle('Open a project'); }
  get exportButton(): Locator { return this.page.getByTitle('Export'); }
  get saveButton(): Locator { return this.page.getByTitle('Save this project, or upload it to a store'); }
  get shareButton(): Locator { return this.page.getByTitle('Share this project'); }
  get languageButton(): Locator { return this.page.getByTitle(/Add a language|language/i).first(); }

  /** Open one of the toolbar dropdowns and pick an item by its visible text. */
  async chooseFromMenu(trigger: Locator, item: string | RegExp): Promise<void> {
    await trigger.click();
    const menuItem = this.page.getByRole('menuitem', { name: item });
    await expect(menuItem.first()).toBeVisible({ timeout: 10_000 });
    await menuItem.first().click();
  }

  // ------------------------------------------------------------ canvas tools

  get selectionTool(): Locator { return this.page.getByTitle('Selection Tool (V)'); }
  get panTool(): Locator { return this.page.getByTitle(/^Pan Tool/); }
  get undoButton(): Locator { return this.page.getByTitle(/^Undo/); }
  get redoButton(): Locator { return this.page.getByTitle(/^Redo/); }
  get zoomInButton(): Locator { return this.page.getByTitle('Zoom In'); }
  get zoomOutButton(): Locator { return this.page.getByTitle('Zoom Out'); }
  get zoomResetButton(): Locator { return this.page.getByTitle('Reset zoom to 100%'); }

  /** The zoom percentage the toolbar is showing, e.g. 100. */
  async zoomLevel(): Promise<number> {
    const text = (await this.zoomResetButton.textContent()) ?? '';
    return Number.parseInt(text.replace('%', '').trim(), 10);
  }

  // ---------------------------------------------------------------- artboards

  /** Every artboard on the canvas. */
  get artboards(): Locator {
    return this.page.locator('[data-artboard-dom-id]');
  }

  board(index = 0): Locator {
    return this.artboards.nth(index);
  }

  /** Elements rendered on a board. Scoped, because Preview renders a second copy. */
  elementsOn(index = 0): Locator {
    return this.board(index).locator('[data-element-id]');
  }

  /** The currently selected element, identified by its selection outline. */
  get selectedElement(): Locator {
    return this.page.locator('[data-element-id]').filter({
      has: this.page.locator('[data-export-exclude="true"][style*="outline"]'),
    });
  }

  // ----------------------------------------------------------------- palette

  /** Elements / Devices / Images / Previews. */
  paletteTab(name: 'Elements' | 'Devices' | 'Images' | 'Previews'): Locator {
    return this.page.getByRole('tab', { name, exact: true });
  }

  get paletteSearch(): Locator {
    return this.page.getByLabel('Search elements by name or id');
  }

  /**
   * Open a palette category, e.g. 'Basic'.
   * The tile carries `title="Browse <label>"` and a visible label of its own,
   * so the title is the only handle that cannot collide with the label text.
   */
  async openPaletteCategory(label: string): Promise<void> {
    await this.page.getByTitle(`Browse ${label}`).click();
  }

  /**
   * Add a library item by its library id, e.g. addElement('Text', 'basic:text').
   * Both halves are in the tile's aria-label, which is what makes it unique.
   */
  async addElement(label: string, libraryId: string): Promise<void> {
    const before = await this.elementsOn(0).count();
    await this.page.getByRole('button', { name: `Add ${label} (${libraryId})`, exact: true }).click();
    await expect(this.elementsOn(0)).toHaveCount(before + 1, { timeout: 20_000 });
  }

  /** Open a category and add one of its items, the common two-step. */
  async addElementFrom(category: string, label: string, libraryId: string): Promise<void> {
    await this.openPaletteCategory(category);
    await this.addElement(label, libraryId);
  }

  // --------------------------------------------------------------- right dock

  dockTab(name: 'Properties' | 'History' | 'Versions'): Locator {
    return this.page.getByRole('tab', { name, exact: true });
  }

  /** The active right-dock panel. Inactive panels stay mounted, so scope to this. */
  get activeDockPanel(): Locator {
    return this.page.locator('[role="tabpanel"][data-state="active"]').last();
  }

  // Properties controls, by the ids PropertiesPanel gives them.
  get textContentInput(): Locator { return this.page.locator('#textContent'); }
  get fontSizeInput(): Locator { return this.page.locator('#fontSize'); }
  get lineHeightInput(): Locator { return this.page.locator('#lineHeight'); }
  get fontColorInput(): Locator { return this.page.locator('#fontColor'); }
  get fontFamilySelect(): Locator { return this.page.locator('#fontFamily'); }

  /** The Layers list, which shares the right dock with Properties. */
  get layersHeader(): Locator {
    return this.page.getByText(/^Layers(:|$)/);
  }

  // ----------------------------------------------------------------- dialogs

  get exportDialog(): Locator {
    return this.page.getByRole('dialog').filter({ hasText: 'Export Screenshots' });
  }

  /** Toolbar Export, then "Artboards as images". */
  async openExportDialog(): Promise<void> {
    await this.chooseFromMenu(this.exportButton, /Artboards as images/i);
    await expect(this.exportDialog).toBeVisible({ timeout: 20_000 });
  }

  get canvasSizeDialog(): Locator {
    return this.page.getByRole('dialog').filter({ hasText: 'Canvas Size' });
  }

  get settingsDialog(): Locator {
    return this.page.getByRole('dialog').filter({ hasText: 'Settings' });
  }

  async openSettings(): Promise<void> {
    await this.page.getByRole('button', { name: 'Settings', exact: true }).first().click();
    await expect(this.settingsDialog).toBeVisible({ timeout: 20_000 });
  }

  get previewDialog(): Locator {
    return this.page.getByRole('dialog').filter({ has: this.page.getByRole('button', { name: /Close preview/i }) });
  }

  async openPreview(): Promise<void> {
    await this.chooseFromMenu(this.previewButton, /Full screen/i);
    await expect(this.previewDialog).toBeVisible({ timeout: 30_000 });
  }

  /** Close whatever dialog is on top. */
  async closeDialog(): Promise<void> {
    await this.page.keyboard.press('Escape');
  }

  // ----------------------------------------------------------------- sidebar

  sidebarButton(name: 'Discover' | 'Account' | 'Settings' | 'About'): Locator {
    return this.page.getByRole('button', { name, exact: true }).first();
  }

  /** The MCP status pill, present on desktop and on a relay-configured web build. */
  get mcpStatusPill(): Locator {
    return this.page.getByTitle(/MCP server/i);
  }
}
