import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures/test';
import { put, waitForProject, type StoredProject } from '../fixtures/db';

// Capture is a view on the activity bar that takes screenshots of the user's
// app from the iOS Simulator or an Android emulator and puts them into the
// project's frames, one language at a time. The web build has no simulator to
// reach, so there every control is on screen and off, with the reason. On the
// desktop project the device is the test runtime's (tests/e2e/fixtures/
// tauri-runtime.ts): a device list given per test, and screenshots it draws
// itself, in a colour that changes with every one.
//
// A screenshot is stored in IndexedDB as a Blob, which Playwright's WebKit
// cannot do (tests/e2e/README.md). So the tests that take one skip on the
// `desktop` project behind the same probe history-versions.spec.ts uses, and
// run on `desktop-chromium`, the Windows WebView2 stand-in.

test.use({ actionTimeout: 30_000 });
test.describe.configure({ timeout: 180_000 });

const CAPTURE_BUTTON = 'Capture screenshots of your app';
const GERMAN = 'de-DE';

const SIMULATOR = {
  id: 'B0DE85F2-7E38-4083-9EA2-C4525D1D3040',
  platform: 'ios',
  kind: 'simulator',
  name: 'iPhone 17 Pro Max',
  state: 'running',
  os: 'iOS 26.5',
  model: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro-Max',
};
const ONE_SIMULATOR = { ios: { devices: [SIMULATOR], models: [] }, android: { devices: [], models: [] } };
const PHONE = { id: 'YPKRA6VS754L6XTO', platform: 'android', kind: 'phone', name: 'M2006C3LG', state: 'running', os: 'Android 11' };
const EMULATOR = { id: 'emulator-5554', platform: 'android', kind: 'emulator', name: 'Pixel 9 Pro API 35', state: 'running', os: 'Android 15' };
const APPS = [{ id: 'com.example.notes', name: 'Notes Pro', running: true }];

/** Whether this browser can put a Blob into IndexedDB (see history-versions.spec.ts). */
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

const NO_BLOBS = 'Playwright WebKit cannot store the screenshot Blob in IndexedDB; desktop-chromium runs this';

function views(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Views' });
}

async function openCapture(page: Page): Promise<Locator> {
  await views(page).getByRole('button', { name: CAPTURE_BUTTON, exact: true }).click();
  const view = page.getByTestId('capture-view');
  await expect(view).toBeVisible();
  return view;
}

/** The wrapper a turned-off control sits in, whose data-gated-reason is its reason. */
function gateOf(control: Locator): Locator {
  return control.locator('xpath=..');
}

function cell(view: Locator, locale: string): Locator {
  return view.locator(`[data-capture-cell$="|${locale}"]`).first();
}

/** A blank project with one iPhone 17 Pro Max frame, selected. */
async function projectWithPhone(app: import('../helpers/editor').Editor): Promise<void> {
  await app.startBlankProject();
  await app.ensurePaletteOpen();
  await app.paletteTab('Devices').click();
  await app.openPaletteCategory('Device Mockups');
  await app.addElement('iPhone 17 Pro Max', 'device:iphone-17-pro-max');
}

/** Add one language through the manager, with machine translation off. */
async function addLanguage(page: Page, code: string, search: string): Promise<void> {
  const collapsed = page.getByRole('button', { name: 'Language', exact: true });
  const expanded = page.locator('button[title^="Showing "]');
  await ((await collapsed.count()) ? collapsed : expanded).first().click();
  await expect(page.getByRole('menu')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('menuitem', { name: /Add language|Manage languages/ }).first().click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'Languages' });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole('textbox', { name: 'Search languages' }).fill(search);
  await dialog.locator(`#locale-${code}`).click();
  const seed = dialog.getByLabel('Fill in machine translations to start from');
  if ((await seed.count()) && (await seed.getAttribute('aria-checked')) === 'true') await seed.click();
  await dialog.getByRole('button', { name: /^(Add \d+ languages?|Save languages)$/ }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
}

interface StoredPhone {
  id: string;
  type: string;
  screenshotSrc?: string;
  captureScreen?: { link?: string };
}

interface StoredBoard {
  elements: StoredPhone[];
  localized?: Record<string, Record<string, { screenshotSrc?: string }>>;
}

function boards(project: StoredProject): StoredBoard[] {
  return project.projectData as StoredBoard[];
}

/** A command answer from the in-page MCP server, the way an agent gets it. */
interface ToolAnswer {
  result?: { isError?: boolean; content?: Array<{ text: string }> };
  error?: unknown;
}

function callTool(page: Page, name: string, args: Record<string, unknown>): Promise<ToolAnswer> {
  return page.evaluate(
    ({ name, args }) =>
      (window as unknown as { __osg: { mcp: (message: unknown) => Promise<ToolAnswer> } }).__osg.mcp({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    { name, args }
  );
}

/** The test runtime's held command answers (tests/e2e/fixtures/tauri-runtime.ts). */
function heldCommands(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __E2E_TAURI__: { commandsHeld: unknown[] } }).__E2E_TAURI__.commandsHeld.length);
}

function releaseCommands(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __E2E_TAURI__: { releaseCommands: () => number } }).__E2E_TAURI__.releaseCommands());
}

const BOARD_ID = 'capture_board';
const VIDEO_ID = 'capture_video';
const PHONE_ID = 'capture_phone';

/**
 * A stored project with a recording frame, and a screenshot frame beside it
 * with `phone`. Two projects made from this share their frame ids, the way a
 * copied project does.
 */
function seedProject(id: string, name: string, phone = false): { id: string; name: string; timestamp: Date; projectData: unknown[] } {
  const frame = (extra: Record<string, unknown>) => ({
    position: { x: 60, y: 300 },
    size: { width: 600, height: 1300 },
    rotation: 0,
    scale: 1,
    deviceType: 'iphone-17-pro-max',
    ...extra,
  });
  return {
    id,
    name,
    timestamp: new Date('2026-11-14T10:00:00.000Z'),
    projectData: [
      {
        id: BOARD_ID,
        name: 'Home',
        size: { width: 1320, height: 2868 },
        backgroundColor: '#ffffff',
        zoom: 1,
        position: { x: 50, y: 50 },
        elements: [
          frame({ id: VIDEO_ID, type: 'video-device', name: 'Recording' }),
          ...(phone ? [frame({ id: PHONE_ID, type: 'device', name: 'Phone', position: { x: 700, y: 300 } })] : []),
        ],
      },
    ],
  };
}

const strip = (page: Page) => page.locator('[data-project-tabs]');

/** Store the projects, then open the first one. */
async function openStored(app: import('../helpers/editor').Editor, page: Page, projects: Array<ReturnType<typeof seedProject>>): Promise<void> {
  await expect(app.startDialog).toBeVisible();
  // Seeding needs the app's own schema in place first.
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
  for (const project of projects) await put(page, 'projects', project);
  await app.goto(`/?projectId=${projects[0].id}`);
  await expect(strip(page).locator('[role="tab"][aria-selected="true"]')).toContainText(projects[0].name);
  await expect(app.board(0).locator(`[data-element-id="${VIDEO_ID}"]`)).toBeVisible();
}

function frameCell(view: Locator, elementId: string): Locator {
  return view.locator(`[data-capture-cell^="${BOARD_ID}:${elementId}|"]`).first();
}

function mediaOf(project: StoredProject): string | undefined {
  const video = (project.projectData as Array<{ elements: Array<{ id: string; mediaId?: string }> }>)[0].elements.find((element) => element.id === VIDEO_ID);
  return video?.mediaId;
}

/** The phone frame of the project's only artboard, and what German shows in it. */
function phoneOf(project: StoredProject): { phone: StoredPhone; german?: string } {
  const [board] = boards(project);
  const phone = board.elements.find((element) => element.type === 'device');
  if (!phone) throw new Error('The project has no phone frame');
  return { phone, german: board.localized?.[GERMAN]?.[phone.id]?.screenshotSrc };
}

test.describe('capture', () => {
  test('Capture is a view on the activity bar that shows the frames by language and says what each control waits for', async ({ app, page, isDesktop, tauri }) => {
    await projectWithPhone(app);
    const view = await openCapture(page);
    await expect(app.exportButton).toBeHidden();
    // One column for the one frame, one row for the base language.
    await expect(view.locator('[data-capture-cell]')).toHaveCount(1);
    await expect(view.getByText('Main language', { exact: true })).toBeVisible();
    // The frame's whole name shows, on as many lines as it needs, not cut off at the column's width.
    const name = view.getByTestId('capture-frame-name');
    await expect(name).toHaveText('Blank Artboard');
    const fit = await name.evaluate((element) => {
      const fits = element.scrollWidth <= element.clientWidth;
      // On one line the same name is too wide for the column, so the check above is not passing on a short name.
      element.style.whiteSpace = 'nowrap';
      const oneLineTooWide = element.scrollWidth > element.clientWidth;
      element.style.whiteSpace = '';
      return { fits, oneLineTooWide };
    });
    expect(fit).toEqual({ fits: true, oneLineTooWide: true });

    const take = view.getByRole('button', { name: 'Take screenshot', exact: true });
    await expect(take).toBeDisabled();
    if (isDesktop) {
      // The test runtime lists no device, so the device picker and Take wait for one.
      await expect(gateOf(take)).toHaveAttribute('data-gated-reason', 'Start a device first');
      await expect(view.getByText(/^No devices found yet/)).toBeVisible();
      // The app list is off too, and says why on screen; its (i) says what the list is for.
      await expect(view.getByTestId('capture-app-waits')).toHaveText('Start a device first to see your apps');
      await view.getByRole('button', { name: 'More about choosing your app', exact: true }).hover();
      await expect(page.getByRole('tooltip')).toContainText("Your app shows up in the list once it's on the device you started.");
      await expect.poll(async () => (await tauri.callsTo('abs_capture_devices')).length).toBeGreaterThan(0);
      // Nothing was taken or changed on a device just by looking.
      expect(await tauri.callsTo('abs_capture_screenshot')).toHaveLength(0);
      expect(await tauri.callsTo('abs_capture_tidy_status_bar')).toHaveLength(0);
    } else {
      await expect(view.getByText('Capture needs the desktop app')).toBeVisible();
      await expect(gateOf(take)).toHaveAttribute('data-gated-reason', 'Needs the desktop app');
    }

    await view.getByRole('button', { name: 'Back to the editor', exact: true }).click();
    await expect(view).toBeHidden();
    await expect(app.exportButton).toBeVisible();
    expect(await tauri.unhandled()).toEqual([]);
  });

  test('the Properties button beside Upload Screenshot is off on the web and opens Capture on the frame when no device runs', async ({ app, page, isDesktop, tauri }) => {
    await projectWithPhone(app);
    const button = page.getByTestId('capture-from-device');
    await expect(button).toBeVisible();
    await expect(button).toContainText('Screenshot from device');
    if (!isDesktop) {
      await expect(button).toBeDisabled();
      await expect(gateOf(button)).toHaveAttribute('data-gated-reason', 'Needs the desktop app');
      return;
    }
    await button.click();
    const view = page.getByTestId('capture-view');
    await expect(view).toBeVisible();
    await expect(view.locator('[data-capture-cell][aria-pressed="true"]')).toHaveCount(1);
    expect(await tauri.callsTo('abs_capture_screenshot')).toHaveLength(0);
    expect(await tauri.unhandled()).toEqual([]);
  });

  test('a screenshot from the running simulator goes into the chosen frame in the chosen language only', async ({ app, page, isDesktop, tauri }) => {
    test.skip(!isDesktop, 'Taking a screenshot needs the desktop app');
    test.skip(!(await canStoreBlobsInIndexedDb(page)), NO_BLOBS);
    await tauri.setResponse('abs_capture_devices', ONE_SIMULATOR);
    await tauri.setResponse('abs_capture_apps', APPS);
    await projectWithPhone(app);
    await addLanguage(page, GERMAN, 'German');
    const before = phoneOf(await waitForProject(page, (project) => boards(project)[0]?.elements.some((element) => element.type === 'device')));

    const view = await openCapture(page);
    // The running simulator is picked on its own, and its status bar tidied.
    await expect(view.getByTestId('capture-device-state')).toContainText('Ready');
    await expect.poll(async () => (await tauri.callsTo('abs_capture_tidy_status_bar')).map((call) => call.args.tidy)).toEqual([true]);
    // Its screen shows live beside the grid, from small previews.
    await expect(view.getByTestId('capture-live-view').locator('img')).toBeVisible();
    expect((await tauri.callsTo('abs_capture_screenshot')).every((call) => call.args.preview === true)).toBe(true);

    await cell(view, GERMAN).click();
    await expect(view.getByTestId('capture-target')).toContainText('Deutsch');
    await view.getByRole('button', { name: 'Take screenshot', exact: true }).click();

    const after = phoneOf(await waitForProject(page, (project) => !!phoneOf(project).german?.startsWith('asset:')));
    // German got the screenshot; the base language kept what it showed.
    expect(after.phone.screenshotSrc).toBe(before.phone.screenshotSrc);
    const shots = (await tauri.callsTo('abs_capture_screenshot')).filter((call) => !call.args.preview);
    expect(shots).toHaveLength(1);
    expect(shots[0].args).toMatchObject({ platform: 'ios', id: SIMULATOR.id });
    // The screenshot is listed for reuse in another frame.
    await expect(view.getByTitle(/^iPhone 17 Pro Max, .*Click to put it in the selected frame$/)).toHaveCount(1);
    expect(await tauri.unhandled()).toEqual([]);
  });

  test('a frame that knows its screen is taken in every language, each from a fresh launch in that language on that screen', async ({ app, page, isDesktop, tauri }) => {
    test.skip(!isDesktop, 'Taking screenshots needs the desktop app');
    test.skip(!(await canStoreBlobsInIndexedDb(page)), NO_BLOBS);
    await tauri.setResponse('abs_capture_devices', ONE_SIMULATOR);
    await tauri.setResponse('abs_capture_apps', APPS);
    await projectWithPhone(app);
    await addLanguage(page, GERMAN, 'German');

    const view = await openCapture(page);
    await expect(view.getByTestId('capture-device-state')).toContainText('Ready');
    const every = view.getByRole('button', { name: 'Take this screen in all languages', exact: true });
    // Until Capture knows how to reach the screen, it can only be taken by hand.
    await expect(gateOf(every)).toHaveAttribute('data-gated-reason', /^First click the icon next to the frame's name/);

    await view.getByRole('button', { name: /^Choose the screen for / }).click();
    // The chooser opens on the saved answer, with no tooltip opened by itself over the answers.
    await expect(page.getByRole('radio', { name: "Another screen, I'll go there myself", exact: true })).toBeFocused();
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    // Each answer says under it when to pick it and what happens then, and the (i) says what a run in every language does.
    await expect(page.getByRole('radio', { name: 'The first screen of my app', exact: true })).toHaveAccessibleDescription(
      /^Choose this if the screenshot shows what people see right after they open your app\. Capture takes it in every language for you\.$/
    );
    await expect(page.getByRole('radio', { name: "Another screen, I'll go there myself", exact: true })).toHaveAccessibleDescription(
      /^Choose this for any other screen.*You take the screenshot in each language yourself\.$/
    );
    await page.getByRole('button', { name: 'How Capture takes every language', exact: true }).hover();
    await expect(page.getByRole('tooltip')).toContainText('Capture restarts your app in each language');
    // A click on the text under an answer picks that answer too.
    await page.getByText(/^Choose this if your app can open the screen from a link/).click();
    await expect(page.getByRole('radio', { name: 'A screen with a link', exact: true })).toBeChecked();
    const save = page.getByRole('button', { name: 'Save', exact: true });
    // Not a link without a scheme, and the chooser says what a link looks like.
    await page.getByRole('textbox', { name: 'Link to this screen' }).fill('settings');
    await expect(save).toBeDisabled();
    await expect(page.getByText('A link looks like myapp://settings', { exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: 'Link to this screen' }).fill('notes://settings');
    await save.click();
    await waitForProject(page, (project) => phoneOf(project).phone.captureScreen?.link === 'notes://settings');

    await expect(every).toBeEnabled();
    await every.click();
    await expect(page.getByText('Took 2 screenshots', { exact: true })).toBeVisible({ timeout: 60_000 });

    const project = await waitForProject(page, (candidate) => {
      const { phone, german } = phoneOf(candidate);
      return !!phone.screenshotSrc?.startsWith('asset:') && !!german?.startsWith('asset:');
    });
    const { phone, german } = phoneOf(project);
    expect(german).not.toBe(phone.screenshotSrc);
    // One launch per language, in that language and on the frame's screen:
    // the link travels with the launch (iOS asks before it opens one from outside).
    const launches = (await tauri.callsTo('abs_capture_launch')).map((call) => call.args);
    expect(launches).toEqual([
      expect.objectContaining({ appId: 'com.example.notes', language: 'en-US', region: 'en_US', link: 'notes://settings' }),
      expect.objectContaining({ appId: 'com.example.notes', language: 'de-DE', region: 'de_DE', link: 'notes://settings' }),
    ]);
    expect(await tauri.unhandled()).toEqual([]);
  });

  test('an agent screenshot goes into its frame without undoing an edit made while it was taken', async ({ app, page, isDesktop, tauri }) => {
    test.skip(!isDesktop, 'Taking a screenshot needs the desktop app');
    test.skip(!(await canStoreBlobsInIndexedDb(page)), NO_BLOBS);
    // The design tools an agent uses, through the headless bridge.
    await page.addInitScript(() => {
      (window as unknown as { __OSG_HEADLESS: boolean }).__OSG_HEADLESS = true;
    });
    await app.goto('/');
    await page.waitForFunction(() => (window as unknown as { __osg?: { ready: boolean } }).__osg?.ready === true);
    await tauri.setResponse('abs_capture_devices', ONE_SIMULATOR);
    await tauri.setResponse('__captureHold', true);
    await projectWithPhone(app);
    const devices =(project: StoredProject) => boards(project)[0]?.elements.filter((element) => element.type === 'device') ?? [];
    const { phone } = phoneOf(await waitForProject(page, (project) => devices(project).length === 1));

    const answer = callTool(page, 'capture_screenshot', { elementId: phone.id });
    // The simulator has not answered yet, and the user adds a second phone meanwhile.
    await expect.poll(() => heldCommands(page)).toBe(1);
    await app.addElement('iPhone 17 Pro Max', 'device:iphone-17-pro-max');
    await waitForProject(page, (project) => devices(project).length === 2);
    await releaseCommands(page);

    const result = await answer;
    expect(result.error).toBeUndefined();
    expect(result.result?.isError).toBeFalsy();
    const project = await waitForProject(page, (candidate) => !!phoneOf(candidate).phone.screenshotSrc?.startsWith('asset:'));
    expect(devices(project)).toHaveLength(2);
    expect(await tauri.unhandled()).toEqual([]);
  });

  test('Record is off while a recording starts, and Stop stays on screen whatever frame is chosen', async ({ app, page, isDesktop, tauri }) => {
    test.skip(!isDesktop, 'Recording needs the desktop app');
    await openStored(app, page, [seedProject('capture_alpha', 'Alpha', true)]);
    await tauri.setResponse('abs_capture_devices', ONE_SIMULATOR);
    await tauri.setResponse('abs_capture_record_start', null);
    await page.evaluate(() => (window as unknown as { __E2E_TAURI__: { config: { held: string[] } } }).__E2E_TAURI__.config.held.push('abs_capture_record_start'));

    const view = await openCapture(page);
    await expect(view.getByTestId('capture-device-state')).toContainText('Ready');
    await frameCell(view, VIDEO_ID).click();
    const goesInto = await view.getByTestId('capture-target').innerText();
    const record = view.getByRole('button', { name: 'Record', exact: true });
    await record.click();
    // Until the device answers, a second click cannot start a second recorder.
    await expect(record).toBeDisabled();
    await expect.poll(async () => (await tauri.callsTo('abs_capture_record_start')).length).toBe(1);
    await releaseCommands(page);
    const stop = view.getByRole('button', { name: /^Stop recording/ });
    await expect(stop).toBeVisible();

    // A screenshot frame chosen while it records keeps Stop, and the recording's frame.
    await frameCell(view, PHONE_ID).click();
    await expect(frameCell(view, PHONE_ID)).toHaveAttribute('aria-pressed', 'true');
    await expect(stop).toBeVisible();
    await expect(view.getByTestId('capture-target')).toHaveText(goesInto);
    await stop.click();
    await expect(page.getByText('The recording was not saved', { exact: true })).toBeVisible();
    expect(await tauri.callsTo('abs_capture_record_start')).toHaveLength(1);
    expect(await tauri.callsTo('abs_capture_record_stop')).toHaveLength(1);
    expect(await tauri.unhandled()).toEqual([]);
  });

  test('a recording goes into the project it was started in, when a copy of that project is open by the time it stops', async ({ app, page, isDesktop, tauri }) => {
    test.skip(!isDesktop, 'Recording needs the desktop app');
    test.skip(!(await canStoreBlobsInIndexedDb(page)), NO_BLOBS);
    await openStored(app, page, [seedProject('capture_alpha', 'Alpha'), seedProject('capture_beta', 'Beta')]);
    await tauri.setResponse('abs_capture_devices', ONE_SIMULATOR);
    await tauri.setResponse('__recordMovie', true);

    let view = await openCapture(page);
    await expect(view.getByTestId('capture-device-state')).toContainText('Ready');
    await frameCell(view, VIDEO_ID).click();
    await view.getByRole('button', { name: 'Record', exact: true }).click();
    const stop = view.getByRole('button', { name: /^Stop recording/ });
    await expect(stop).toBeVisible();

    // Beta has the same frame ids as Alpha, and opens in a new tab while Alpha's recording runs.
    await view.getByRole('button', { name: 'Back to the editor', exact: true }).click();
    await strip(page).getByRole('button', { name: 'New tab', exact: true }).click();
    await app.waitForStartDialogReady();
    await app.startDialog.getByText('Beta', { exact: true }).click();
    await expect(app.startDialog).toBeHidden();
    await expect(strip(page).locator('[role="tab"][aria-selected="true"]')).toContainText('Beta');

    view = await openCapture(page);
    await stop.click();
    await expect(page.getByText('The recording went into Alpha', { exact: true })).toBeVisible({ timeout: 30_000 });
    const alpha = await waitForProject(page, (project) => project.id === 'capture_alpha' && !!mediaOf(project));
    expect(mediaOf(alpha)).toMatch(/^media_/);
    const beta = await waitForProject(page, (project) => project.id === 'capture_beta');
    expect(mediaOf(beta)).toBeUndefined();
    expect(await tauri.unhandled()).toEqual([]);
  });

  test('Screenshot from device takes the running simulator straight into the selected frame', async ({ app, page, isDesktop, tauri }) => {
    test.skip(!isDesktop, 'Taking a screenshot needs the desktop app');
    test.skip(!(await canStoreBlobsInIndexedDb(page)), NO_BLOBS);
    await tauri.setResponse('abs_capture_devices', ONE_SIMULATOR);
    await projectWithPhone(app);
    await page.getByTestId('capture-from-device').click();
    await expect(page.getByText('Screenshot from iPhone 17 Pro Max', { exact: true })).toBeVisible();
    await waitForProject(page, (project) => !!phoneOf(project).phone.screenshotSrc?.startsWith('asset:'));
    // The editor stayed in front: the shortcut does not open Capture.
    await expect(page.getByTestId('capture-view')).toHaveCount(0);
    expect(await tauri.unhandled()).toEqual([]);
  });

  test('Screenshot from device is off for an iPhone frame on a computer without the iPhone Simulator', async ({ app, page, isDesktop, tauri }) => {
    test.skip(!isDesktop, 'On the web every Capture control is off already');
    // Windows: no iPhone Simulator, an Android emulator running.
    await tauri.setResponse('abs_capture_devices', { ios: { missing: 'mac', devices: [], models: [] }, android: { devices: [EMULATOR], models: [] } });
    await projectWithPhone(app);
    const button = page.getByTestId('capture-from-device');
    await expect(button).toContainText('Screenshot from device');
    await expect(button).toBeDisabled();
    await expect(gateOf(button)).toHaveAttribute('data-gated-reason', 'Virtual iPhones need a Mac with Xcode');
    expect(await tauri.callsTo('abs_capture_screenshot')).toHaveLength(0);
    expect(await tauri.unhandled()).toEqual([]);
  });

  test('Capture picks a running emulator by itself, and leaves a phone alone until the user picks it', async ({ app, page, isDesktop, tauri }) => {
    test.skip(!isDesktop, 'Capture lists devices in the desktop app only');
    // adb lists the phone first.
    await tauri.setResponse('abs_capture_devices', { ios: { devices: [], models: [] }, android: { devices: [PHONE, EMULATOR], models: [] } });
    await projectWithPhone(app);
    const view = await openCapture(page);
    await expect(view.getByRole('combobox', { name: 'Device' })).toContainText('Pixel 9 Pro API 35');
    await expect(view.getByTestId('capture-device-state')).toContainText('Ready');
    // Only the emulator's status bar was tidied; the phone was never touched.
    await expect.poll(async () => (await tauri.callsTo('abs_capture_tidy_status_bar')).map((call) => call.args.id)).toEqual(['emulator-5554']);
    expect(await tauri.unhandled()).toEqual([]);
  });
});
