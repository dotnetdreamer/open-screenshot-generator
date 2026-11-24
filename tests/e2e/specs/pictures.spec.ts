/**
 * The app shows the WebP made from each PNG picture, the desktop app downloads
 * template art and library pictures the first time they are used, and nothing
 * a user saved before stops working.
 *
 * A project names its pictures by their PNG paths. It has to open with every
 * picture on its artboards and keep those paths, in its stored row and in an
 * exported project file, because an installed copy of the CLI from before
 * renders the same file and knows only the PNG names (lib/pictureRenames.ts).
 * For the same reason a picture added now is stored under its PNG name. A picture that does not
 * download is never put in a design: a library picture is not added, clicked
 * or dropped, a template is not started, an agent's element is refused, and a
 * saved project opens with a message about what is missing. A template left
 * while its pictures download does not open over what the user went to.
 */
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '../fixtures/test';
import { put, readProjects, type StoredProject } from '../fixtures/db';
import type { TauriHarness } from '../fixtures/tauri';
import { Editor } from '../helpers/editor';

const OLD_PHOTO = '/elements/images/touch/touch-as451105828.png';
const OLD_SCREEN = '/data/projects/amoura-dating-screen-1.png';
const OLD_BACKGROUND = '/data/projects/fg-paws-photo.png';
/** Couple thumbs up: the name the library and a design keep, and the file the desktop app downloads for it. */
const COUPLE = '/elements/images/couples/couples-as227869490.png';
const COUPLE_FILE = '/elements/images/couples/couples-as227869490.webp';
const KASSA_SCREENS = [1, 2, 3, 4, 5].map((n) => `/data/projects/kassa-money-screen-${n}.webp`);
const OFFLINE = 'unreachable: error sending request: connection refused';

function projectWithOldPaths(): StoredProject {
  return {
    id: 'proj_old_png_paths',
    name: 'Saved before WebP',
    timestamp: new Date('2026-11-01T10:00:00.000Z'),
    projectData: [
      {
        id: 'board_old_png',
        name: 'Old paths',
        size: { width: 1206, height: 2622 },
        backgroundColor: '#F7EFE6',
        backgroundImage: OLD_BACKGROUND,
        zoom: 1,
        position: { x: 15, y: 15 },
        elements: [
          {
            id: 'el_old_photo',
            type: 'image',
            name: 'hand',
            position: { x: 100, y: 1500 },
            size: { width: 800, height: 792 },
            rotation: 0,
            scale: 1,
            imageSrc: OLD_PHOTO,
            imageAlt: '',
            objectFit: 'contain',
          },
          {
            id: 'el_old_phone',
            type: 'device',
            name: 'phone',
            position: { x: 300, y: 300 },
            size: { width: 560, height: 1125 },
            rotation: 0,
            scale: 1,
            deviceType: 'iphone-15',
            styleType: 'normal',
            frameColor: '#23181B',
            screenshotSrc: OLD_SCREEN,
            naturalScreenshotWidth: 1692,
            naturalScreenshotHeight: 3420,
            screenshotObjectFit: 'cover',
            screenshotRect: { left: 0, top: 0, width: 100, height: 100 },
          },
          {
            // Words a user typed that happen to be a picture path stay as typed.
            id: 'el_caption',
            type: 'text',
            name: 'caption',
            position: { x: 100, y: 100 },
            size: { width: 1000, height: 120 },
            rotation: 0,
            scale: 1,
            content: OLD_PHOTO,
            fontSize: 12,
            fontFamily: 'Inter',
            color: '#111111',
          },
        ],
      },
    ],
  } as unknown as StoredProject;
}

/** Every <img> on the artboards: its src, and whether it decoded. */
function boardPictures(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-artboard-dom-id] img')].map((img) => ({
      src: (img as HTMLImageElement).getAttribute('src') ?? '',
      loaded: (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0,
    }))
  );
}

/** Seed a project row once the app has made its database, and land back on the start dialog. */
async function seed(page: Page, editor: Editor, project: StoredProject): Promise<void> {
  await editor.goto();
  await expect(editor.startDialog).toBeVisible();
  await expect.poll(() => page.evaluate(() => indexedDB.databases().then((dbs) => dbs.map((db) => db.name)))).toContain('ProjectDatabase');
  await put(page, 'projects', project);
  await editor.goto('/');
  await expect(editor.startDialog).toBeVisible();
}

async function openRecent(editor: Editor, name: string): Promise<void> {
  await editor.startDialog.getByText(name, { exact: true }).click();
  await expect(editor.startDialog).toBeHidden();
  await expect(editor.artboards).toHaveCount(1);
}

/** The start dialog's card for a template, by its name. */
function templateCard(editor: Editor, name: string) {
  return editor.startDialog.locator('.group').filter({ has: editor.page.getByRole('img', { name, exact: true }) }).first();
}

/** Picture downloads wait from now on until letDownloadsFinish, to act while one is in flight. */
function holdDownloads(page: Page): Promise<unknown> {
  return page.evaluate(() => (window as unknown as { __E2E_TAURI__: { config: { held: string[] } } }).__E2E_TAURI__.config.held.push('abs_downloads_fetch'));
}

/** Every download held so far finishes, the ones after it are not held, and nothing is left to download. */
async function letDownloadsFinish(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = (window as unknown as { __E2E_TAURI__: { config: { held: string[] }; releaseCommands: () => number } }).__E2E_TAURI__;
    state.config.held = state.config.held.filter((cmd) => cmd !== 'abs_downloads_fetch');
    state.releaseCommands();
  });
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __E2E_TAURI__: { config: { missingPictures: string[] } } }).__E2E_TAURI__.config.missingPictures.length))
    .toBe(0);
}

/** The designs stored on this device, as text. */
async function storedDesigns(page: Page): Promise<string> {
  return JSON.stringify((await readProjects(page)).map((project) => project.projectData));
}

let mcpCalls = 0;

/** A tool call to the design server, as an agent sends it. */
async function mcpCall(tauri: TauriHarness, name: string, args: Record<string, unknown>) {
  const id = ++mcpCalls;
  const callId = `pictures-call-${id}`;
  await tauri.emitFromBackend('abs-mcp-request', {
    callId,
    nonce: 'e2e-bridge-nonce',
    agent: false,
    message: { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } },
  });
  const reply = async () => (await tauri.callsTo('abs_mcp_respond')).find((call) => call.args.callId === callId);
  await expect.poll(async () => !!(await reply()), { timeout: 30_000, message: `${name} was never answered` }).toBe(true);
  const response = (await reply())!.args.response as { result?: { isError?: boolean; content?: Array<{ text?: string }> } };
  return { isError: response.result?.isError === true, text: response.result?.content?.map((part) => part.text ?? '').join('\n') ?? '' };
}

test.describe('pictures', () => {
  test('a project saved with the old PNG picture paths opens with every picture, and keeps those paths and its words', async ({ page, tauri, isDesktop }) => {
    const missing: string[] = [];
    page.on('response', (response) => {
      const url = new URL(response.url());
      if (/\.(png|webp)$/.test(url.pathname) && response.status() >= 400) missing.push(`${response.status()} ${url.pathname}`);
    });
    const editor = new Editor(page);
    await seed(page, editor, projectWithOldPaths());
    await openRecent(editor, 'Saved before WebP');

    await expect
      .poll(async () => {
        const pictures = await boardPictures(page);
        const wanted = ['touch-as451105828', 'amoura-dating-screen-1', 'fg-paws-photo'];
        return wanted.map((name) => pictures.find((picture) => picture.src.includes(name)) ?? null);
      }, { timeout: 30_000 })
      .toEqual([
        { src: '/elements/images/touch/touch-as451105828.webp', loaded: true },
        { src: '/data/projects/amoura-dating-screen-1.webp', loaded: true },
        { src: '/data/projects/fg-paws-photo.webp', loaded: true },
      ]);
    expect(missing).toEqual([]);
    await expect(editor.board(0).locator('[data-element-id="el_caption"]')).toContainText(OLD_PHOTO);

    // The row it was read from still names the PNGs, and so does the caption.
    const [stored] = (await readProjects(page)).filter((project) => project.id === 'proj_old_png_paths');
    const text = JSON.stringify(stored.projectData);
    for (const old of [OLD_PHOTO, OLD_SCREEN, OLD_BACKGROUND]) expect(text).toContain(old);
    expect(text).not.toContain('.webp');

    // So does the project file it exports, which is what a CLI from before reads.
    let exported: string;
    if (isDesktop) {
      await editor.chooseFromMenu(editor.exportButton, /Project file/i);
      await tauri.waitForFiles(1);
      exported = (await tauri.lastJson())?.text ?? '';
    } else {
      const download = page.waitForEvent('download');
      await editor.chooseFromMenu(editor.exportButton, /Project file/i);
      exported = fs.readFileSync((await (await download).path()) as string, 'utf8');
    }
    const fileText = JSON.stringify(JSON.parse(exported).projectData);
    for (const old of [OLD_PHOTO, OLD_SCREEN, OLD_BACKGROUND]) expect(fileText).toContain(old);
    expect(fileText).not.toContain('.webp');
  });

  test('an old project file, imported and exported again, keeps its PNG paths and its words', async ({ app, page, tauri, isDesktop }, testInfo) => {
    await app.startBlankProject();
    const old = projectWithOldPaths();
    const file = {
      formatVersion: 1,
      id: 'proj_from_old_editor',
      name: 'From the old editor',
      timestamp: new Date('2026-11-01T10:00:00.000Z').toISOString(),
      projectData: old.projectData,
      media: [],
    };
    const onDisk = testInfo.outputPath('old-editor-project.json');
    fs.mkdirSync(path.dirname(onDisk), { recursive: true });
    fs.writeFileSync(onDisk, JSON.stringify(file, null, 2), 'utf8');

    const chooser = page.waitForEvent('filechooser');
    await app.chooseFromMenu(app.openProjectButton, /From a project file/i);
    await (await chooser).setFiles(onDisk);
    await expect(app.artboards).toHaveCount(1);
    await expect(app.board(0).locator('[data-element-id="el_caption"]')).toContainText(OLD_PHOTO);
    await expect
      .poll(async () => (await boardPictures(page)).filter((picture) => picture.loaded && picture.src.endsWith('.webp')).length, { timeout: 30_000 })
      .toBe(3);

    let exported: string;
    if (isDesktop) {
      await app.chooseFromMenu(app.exportButton, /Project file/i);
      await tauri.waitForFiles(1);
      exported = (await tauri.lastJson())?.text ?? '';
    } else {
      const download = page.waitForEvent('download');
      await app.chooseFromMenu(app.exportButton, /Project file/i);
      exported = fs.readFileSync((await (await download).path()) as string, 'utf8');
    }
    const fileText = JSON.stringify(JSON.parse(exported).projectData);
    for (const path of [OLD_PHOTO, OLD_SCREEN, OLD_BACKGROUND]) expect(fileText).toContain(path);
    expect(fileText).not.toContain('.webp');
  });

  test('browsing the palette shows the small copies and downloads no full picture, and a tile places the full one', async ({ page, tauri, isDesktop }) => {
    const fullPictures: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/elements/images/') && !url.pathname.startsWith('/elements/images/badges/')) fullPictures.push(url.pathname);
    });
    const editor = new Editor(page);
    await editor.goto();
    await editor.startBlankProject();
    await editor.ensurePaletteOpen();
    await editor.paletteTab('Images').click();
    await editor.openPaletteCategory('Couples');
    const tiles = page.locator('button[aria-label^="Add "][aria-label*="(image:couples-"]');
    await expect(tiles).toHaveCount(6);
    // In the desktop app none of the six is downloaded yet.
    const couples = [...fs.readFileSync(path.join(process.cwd(), 'src/lib/imageLibrary.ts'), 'utf8').matchAll(/'(\/elements\/images\/couples\/[^']+)'/g)].map((match) => match[1]);
    expect(couples).toHaveLength(6);
    // The library keeps the names they shipped with; the app asks for their files.
    if (isDesktop) await tauri.setMissingPictures(couples.map((name) => name.replace(/\.png$/, '.webp')));
    // The pointer crossing every tile, as browsing does.
    for (let i = 0; i < 6; i += 1) await tiles.nth(i).hover();
    await expect
      .poll(() => tiles.locator('img').evaluateAll((imgs) => imgs.map((img) => {
        const picture = img as HTMLImageElement;
        return picture.complete && picture.naturalWidth > 0 && picture.naturalWidth <= 360 && picture.naturalHeight <= 360 && picture.getAttribute('src')!.startsWith('/thumbs/');
      })))
      .toEqual([true, true, true, true, true, true]);
    expect(fullPictures).toEqual([]);
    expect(await tauri.callsTo('abs_downloads_fetch')).toEqual([]);

    await editor.addElement('Couple thumbs up', 'image:couples-as227869490');
    if (isDesktop) expect((await tauri.callsTo('abs_downloads_fetch')).map((call) => call.args.path)).toEqual([COUPLE_FILE]);
    const placed = editor.board(0).locator('[data-element-id] img').last();
    await expect(placed).toHaveAttribute('src', COUPLE_FILE);
    await expect
      .poll(() => placed.evaluate((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(360);
    // The design stores the name the picture shipped with, the only one a CLI from before knows.
    await expect.poll(() => storedDesigns(page), { timeout: 20_000 }).toContain(COUPLE);
    expect(await storedDesigns(page)).not.toContain(COUPLE_FILE);
  });

  test('a library picture that does not download is not added, and the same click adds it once it does', async ({ page, tauri, isDesktop }) => {
    test.skip(!isDesktop, 'only the desktop app downloads pictures');
    const editor = new Editor(page);
    await editor.goto();
    await editor.startBlankProject();
    await editor.ensurePaletteOpen();
    await editor.paletteTab('Images').click();
    await editor.openPaletteCategory('Couples');
    const before = await editor.elementsOn(0).count();

    await tauri.setMissingPictures([COUPLE_FILE], { [COUPLE_FILE]: OFFLINE });
    await page.getByRole('button', { name: 'Add Couple thumbs up (image:couples-as227869490)', exact: true }).click();
    await expect(page.getByText("That picture didn't download").first()).toBeVisible();
    // Long enough for an add that was going to happen anyway.
    await page.waitForTimeout(1000);
    await expect(editor.elementsOn(0)).toHaveCount(before);

    // Back online: the same click downloads it, then adds it.
    await tauri.setMissingPictures([COUPLE_FILE]);
    await editor.addElement('Couple thumbs up', 'image:couples-as227869490');
    expect((await tauri.callsTo('abs_downloads_fetch')).map((call) => call.args.path)).toContain(COUPLE_FILE);
  });

  test('a library picture dropped on an artboard is not added either until it downloads', async ({ page, tauri, isDesktop }) => {
    test.skip(!isDesktop, 'only the desktop app downloads pictures');
    const editor = new Editor(page);
    await editor.goto();
    await editor.startBlankProject();
    await editor.ensurePaletteOpen();
    await editor.paletteTab('Images').click();
    await editor.openPaletteCategory('Couples');
    const before = await editor.elementsOn(0).count();
    const tile = page.getByRole('button', { name: 'Add Couple thumbs up (image:couples-as227869490)', exact: true });
    // The HTML5 drag a mouse makes: the tile writes the payload, the drop on the artboard reads it.
    const drop = async () => {
      const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
      await tile.dispatchEvent('dragstart', { dataTransfer });
      await editor.board(0).dispatchEvent('drop', { dataTransfer });
    };

    await tauri.setMissingPictures([COUPLE_FILE], { [COUPLE_FILE]: OFFLINE });
    await drop();
    await expect(page.getByText("That picture didn't download").first()).toBeVisible();
    await page.waitForTimeout(1000);
    await expect(editor.elementsOn(0)).toHaveCount(before);

    await tauri.setMissingPictures([COUPLE_FILE]);
    await drop();
    await expect(editor.elementsOn(0)).toHaveCount(before + 1);
    await expect(editor.board(0).locator('[data-element-id] img').last()).toHaveAttribute('src', COUPLE_FILE);
  });

  test('a template whose pictures do not download is not started', async ({ page, tauri, isDesktop }) => {
    test.skip(!isDesktop, 'only the desktop app downloads pictures');
    const editor = new Editor(page);
    await editor.goto();
    await expect(editor.startDialog).toBeVisible();
    const projectsBefore = (await readProjects(page)).length;
    await tauri.setMissingPictures(KASSA_SCREENS, Object.fromEntries(KASSA_SCREENS.map((screen) => [screen, OFFLINE])));

    await templateCard(editor, 'Kassa Money').click();
    await expect(page.getByText("This template's pictures didn't download").first()).toBeVisible();
    await expect(editor.startDialog).toBeVisible();
    expect((await readProjects(page)).length).toBe(projectsBefore);
  });

  test('a template filled with your own screenshots needs none of its sample screenshots, whatever its words say', async ({ page, tauri, isDesktop }) => {
    test.skip(!isDesktop, 'only the desktop app downloads pictures');
    const editor = new Editor(page);
    await editor.goto();
    await editor.dismissStartDialog();
    // Offline, with every sample screenshot and the Couple picture still to download.
    const missing = [...KASSA_SCREENS, COUPLE_FILE];
    await tauri.setMissingPictures(missing, Object.fromEntries(missing.map((picture) => [picture, OFFLINE])));

    const png = fs.readFileSync(path.join(process.cwd(), 'public/elements/images/badges/google-play.png')).toString('base64');
    const shot = `data:image/png;base64,${png}`;
    const slots = ['kassa-phone-20', 'kassa-phone-40', 'kassa-phone-59', 'kassa-phone-79', 'kassa-phone3d-103'];
    // Lines of copy that read like the path of a sample screenshot, or of a library
    // picture this computer does not have, are words, not pictures.
    const captions = ['/data/projects/kassa-money-screen-1.png', COUPLE];
    const result = await mcpCall(tauri, 'create_project_from_template', {
      templateId: 'template_kassa-money',
      name: 'Filled offline',
      texts: [
        { elementId: 'kassa-b1-subline-19', content: captions[0] },
        { elementId: 'kassa-b2-subline-39', content: captions[1] },
      ],
      screenshots: slots.map((elementId) => ({ elementId, src: shot })),
    });
    expect(result.isError, result.text).toBe(false);
    const created = (await readProjects(page)).find((project) => project.name === 'Filled offline');
    expect(created).toBeTruthy();
    for (const caption of captions) expect(JSON.stringify(created!.projectData)).toContain(caption);
    expect(await tauri.callsTo('abs_downloads_fetch')).toEqual([]);
  });

  test("an agent's library picture that does not download is refused, and nothing is added", async ({ page, tauri, isDesktop }) => {
    test.skip(!isDesktop, 'only the desktop app downloads pictures');
    const editor = new Editor(page);
    await editor.goto();
    await editor.startBlankProject();
    const before = await editor.elementsOn(0).count();
    await tauri.setMissingPictures([COUPLE_FILE], { [COUPLE_FILE]: OFFLINE });

    const result = await mcpCall(tauri, 'add_element', { libraryId: 'image:couples-as227869490', x: 100, y: 100 });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("didn't download");
    await expect(editor.elementsOn(0)).toHaveCount(before);
  });

  test('a template left while its pictures download does not open over the project opened instead', async ({ page, tauri, isDesktop }) => {
    test.skip(!isDesktop, 'only the desktop app downloads pictures');
    const editor = new Editor(page);
    await seed(page, editor, projectWithOldPaths());
    await tauri.setMissingPictures(KASSA_SCREENS);
    await holdDownloads(page);
    await templateCard(editor, 'Kassa Money').click();
    await expect.poll(async () => (await tauri.callsTo('abs_downloads_fetch')).length).toBeGreaterThan(0);

    await openRecent(editor, 'Saved before WebP');
    await letDownloadsFinish(page);
    // Time for the template to have opened, had it still been wanted.
    await page.waitForTimeout(2000);
    await expect(editor.artboards).toHaveCount(1);
    await expect(page.locator('[data-artboard-dom-id="board_old_png"]')).toBeVisible();
    expect((await readProjects(page)).map((project) => project.name)).not.toContain('Kassa Money Copy');
    await expect(page.getByText(/Downloading pictures/)).toHaveCount(0);
  });

  test("an agent's template is not created over a project the user opened while its pictures downloaded", async ({ page, tauri, isDesktop }) => {
    test.skip(!isDesktop, 'only the desktop app downloads pictures');
    const editor = new Editor(page);
    await seed(page, editor, projectWithOldPaths());
    await tauri.setMissingPictures(KASSA_SCREENS);
    await holdDownloads(page);
    const answer = mcpCall(tauri, 'create_project_from_template', { templateId: 'template_kassa-money', name: 'Agent Kassa' });
    await expect.poll(async () => (await tauri.callsTo('abs_downloads_fetch')).length).toBeGreaterThan(0);

    await openRecent(editor, 'Saved before WebP');
    await letDownloadsFinish(page);
    const result = await answer;
    expect(result.isError).toBe(true);
    expect(result.text).toContain('Another project was opened');
    await expect(editor.artboards).toHaveCount(1);
    expect((await readProjects(page)).map((project) => project.name)).not.toContain('Agent Kassa');
  });

  test('a template left by closing the start dialog does not open later', async ({ page, tauri, isDesktop }) => {
    test.skip(!isDesktop, 'only the desktop app downloads pictures');
    const editor = new Editor(page);
    await seed(page, editor, projectWithOldPaths());
    await tauri.setMissingPictures(KASSA_SCREENS);
    await holdDownloads(page);
    await templateCard(editor, 'Kassa Money').click();
    await expect.poll(async () => (await tauri.callsTo('abs_downloads_fetch')).length).toBeGreaterThan(0);

    // Closed with nothing open, the dialog starts a blank project as it always has.
    await page.keyboard.press('Escape');
    await expect(editor.startDialog).toBeHidden();
    await expect(editor.artboards).toHaveCount(1);
    await letDownloadsFinish(page);
    await page.waitForTimeout(2000);
    await expect(editor.artboards).toHaveCount(1);
    expect((await readProjects(page)).map((project) => project.name)).not.toContain('Kassa Money Copy');

    // Picked again, with its pictures here now, it opens.
    await page.locator('[data-project-tabs]').getByRole('button', { name: 'New tab', exact: true }).click();
    await expect(editor.startDialog).toBeVisible();
    await templateCard(editor, 'Kassa Money').click();
    await expect(editor.artboards).toHaveCount(5);
  });

  test('a blank canvas picked while a template downloads wins, and the template never opens', async ({ page, tauri, isDesktop }) => {
    test.skip(!isDesktop, 'only the desktop app downloads pictures');
    const editor = new Editor(page);
    await editor.goto();
    await editor.waitForStartDialogReady();
    await tauri.setMissingPictures(KASSA_SCREENS);
    await holdDownloads(page);
    await templateCard(editor, 'Kassa Money').click();
    await expect.poll(async () => (await tauri.callsTo('abs_downloads_fetch')).length).toBeGreaterThan(0);

    await page.getByRole('button', { name: /Start with a blank canvas/i }).first().click();
    await expect(editor.startDialog).toBeHidden();
    await expect(editor.artboards).toHaveCount(1);
    await letDownloadsFinish(page);
    await page.waitForTimeout(2000);
    await expect(editor.artboards).toHaveCount(1);
    expect((await readProjects(page)).map((project) => project.name)).not.toContain('Kassa Money Copy');
  });

  test('a template clicked twice while it downloads opens once', async ({ page, tauri, isDesktop }) => {
    test.skip(!isDesktop, 'only the desktop app downloads pictures');
    const editor = new Editor(page);
    await editor.goto();
    await editor.waitForStartDialogReady();
    await tauri.setMissingPictures(KASSA_SCREENS);
    await holdDownloads(page);
    await templateCard(editor, 'Kassa Money').click();
    await expect.poll(async () => (await tauri.callsTo('abs_downloads_fetch')).length).toBeGreaterThan(0);
    await templateCard(editor, 'Kassa Money').click();

    await letDownloadsFinish(page);
    await expect(editor.artboards).toHaveCount(5);
    await page.waitForTimeout(1000);
    expect((await readProjects(page)).filter((project) => project.name === 'Kassa Money Copy')).toHaveLength(1);
  });

  test('going back to the open project from Recent projects stops a template still downloading', async ({ page, tauri, isDesktop }) => {
    test.skip(!isDesktop, 'only the desktop app downloads pictures');
    const editor = new Editor(page);
    await seed(page, editor, projectWithOldPaths());
    await openRecent(editor, 'Saved before WebP');
    await page.locator('[data-project-tabs]').getByRole('button', { name: 'New tab', exact: true }).click();
    await expect(editor.startDialog).toBeVisible();
    await tauri.setMissingPictures(KASSA_SCREENS);
    await holdDownloads(page);
    await templateCard(editor, 'Kassa Money').click();
    await expect.poll(async () => (await tauri.callsTo('abs_downloads_fetch')).length).toBeGreaterThan(0);

    // The project that is open already: nothing new goes on the canvas.
    await editor.startDialog.getByText('Saved before WebP', { exact: true }).click();
    await expect(editor.startDialog).toBeHidden();
    await letDownloadsFinish(page);
    await page.waitForTimeout(2000);
    await expect(editor.artboards).toHaveCount(1);
    await expect(page.locator('[data-artboard-dom-id="board_old_png"]')).toBeVisible();
    expect((await readProjects(page)).map((project) => project.name)).not.toContain('Kassa Money Copy');
  });

  test('a saved project whose pictures do not download opens anyway, and says what is missing', async ({ page, tauri, isDesktop }) => {
    test.skip(!isDesktop, 'only the desktop app downloads pictures');
    const editor = new Editor(page);
    await seed(page, editor, projectWithOldPaths());
    // The old PNG name is asked about as the WebP it became.
    const webp = '/elements/images/touch/touch-as451105828.webp';
    await tauri.setMissingPictures([webp], { [webp]: OFFLINE });
    await openRecent(editor, 'Saved before WebP');
    await expect(page.getByText("Some pictures in this project didn't download").first()).toBeVisible();
  });
});
