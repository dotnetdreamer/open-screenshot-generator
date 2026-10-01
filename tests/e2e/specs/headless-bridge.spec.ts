import { test, expect, type Page } from '../fixtures/test';
import {
  holdProjects,
  readAll,
  readProjects,
  waitForProject,
  type ProjectsHold,
  type StoredProject,
} from '../fixtures/db';
import { Editor } from '../helpers/editor';

/**
 * The npm CLI's way into the editor: `window.__osg`, the headless bridge in
 * src/lib/headless/bridge.ts.
 *
 * The CLI opens a project with `loadProject(data, name, id)` and then edits it
 * with the MCP design tools through `mcp()`, one call straight after another.
 * A project opened that way has to behave like one made in the UI: it is
 * stored under the id it was given, every edit stays, and undo steps back
 * through those edits. The second test covers the CLI editing an empty
 * document, where the first edit is what creates the project. The third sends
 * its calls from inside the page, each one the moment the last one answers.
 *
 * The rest are about the moment a project is opening, when the editor already
 * names it but the canvas still shows the project before it, or nothing after
 * a reload. A call sent then waits for the project, nothing done then is saved
 * under its id, and nothing says it changed what it did not. A rename or a
 * named version asked for then is turned down and says why, and Duplicate on
 * the row of the project being opened copies that project, not the canvas.
 * An edit the project being left took before the switch is still saved to
 * that project, and a translation that finishes after the switch is saved
 * nowhere. The last test is a document with no artboards, which the editor
 * does not open at all.
 */

interface BridgeStatus {
  projectId: string | null;
  projectName: string;
  artboards: { id: string; elements: number }[];
}

/** One empty board, at the Play Store feature graphic size. */
const BOARD = {
  id: 'ab_bridge',
  name: 'Bridge board',
  position: { x: 0, y: 0 },
  size: { width: 1024, height: 500 },
  backgroundColor: '#1e6a56',
  backgroundType: 'solid',
  zoom: 1,
  elements: [],
};

/**
 * Longer than the editor takes to read a stored row back and apply it, so an
 * edit still on the canvas after this wait was not overwritten by such a read.
 */
const SETTLE_MS = 4_000;

/**
 * How long the editor waits after an edit before it writes the project's row:
 * PROJECT_SAVE_DELAY_MS in src/lib/projectSaveQueue.ts.
 */
const SAVE_DELAY_MS = 600;

/**
 * Run `work` while every timer of SAVE_DELAY_MS that the page starts waits 20
 * seconds instead, and return how many there were.
 *
 * The race it is for is a save still waiting when the editor switches
 * projects. Stretching the wait makes the switch win that race every time,
 * however fast this machine renders, so a test fails whenever the editor drops
 * such a save, not only on a machine slow enough to show it.
 */
async function stretchSaveDelay(page: Page, work: () => Promise<unknown>): Promise<number> {
  await page.evaluate((delay) => {
    type SetTimeout = (handler: unknown, timeout?: number, ...args: unknown[]) => unknown;
    const scope = window as unknown as {
      setTimeout: SetTimeout;
      __E2E_STRETCH__: { count: number; restore(): void };
    };
    const original = scope.setTimeout;
    const state = {
      count: 0,
      restore: () => {
        scope.setTimeout = original;
      },
    };
    scope.__E2E_STRETCH__ = state;
    scope.setTimeout = (handler, timeout, ...args) => {
      if (timeout !== delay) return original.call(window, handler, timeout, ...args);
      state.count += 1;
      return original.call(window, handler, 20_000, ...args);
    };
  }, SAVE_DELAY_MS);
  try {
    await work();
  } finally {
    await page.evaluate(() => (window as unknown as { __E2E_STRETCH__: { restore(): void } }).__E2E_STRETCH__.restore());
  }
  return page.evaluate(() => (window as unknown as { __E2E_STRETCH__: { count: number } }).__E2E_STRETCH__.count);
}

/** Load the editor the way the CLI driver does, with the flag set before navigation. */
async function openHeadless(page: Page): Promise<Editor> {
  await page.addInitScript(() => {
    (window as unknown as { __OSG_HEADLESS: boolean }).__OSG_HEADLESS = true;
  });
  const editor = new Editor(page);
  await editor.goto();
  await page.waitForFunction(
    () => (window as unknown as { __osg?: { ready: boolean } }).__osg?.ready === true
  );
  return editor;
}

/** One design tool through the bridge. Throws when the tool refuses. */
async function callTool(page: Page, name: string, args: Record<string, unknown>): Promise<unknown> {
  const response = (await page.evaluate(
    (message) =>
      (window as unknown as { __osg: { mcp: (m: unknown) => Promise<unknown> } }).__osg.mcp(message),
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }
  )) as { result?: { content: { text?: string }[]; isError?: boolean }; error?: { message: string } };
  if (response.error) throw new Error(`${name}: ${response.error.message}`);
  const text = response.result?.content.map((part) => part.text ?? '').join('') ?? '';
  if (response.result?.isError) throw new Error(`${name}: ${text}`);
  return JSON.parse(text);
}

function bridgeStatus(page: Page): Promise<BridgeStatus> {
  return page.evaluate(() =>
    (window as unknown as { __osg: { status: () => BridgeStatus } }).__osg.status()
  );
}

async function elementCount(page: Page): Promise<number> {
  const status = await bridgeStatus(page);
  return status.artboards.reduce((sum, board) => sum + board.elements, 0);
}

function storedElementCount(project: StoredProject): number {
  const boards = project.projectData as { elements: unknown[] }[];
  return boards.reduce((sum, board) => sum + board.elements.length, 0);
}

/** A stored project, as name and `<board id>:<element count>` per board. */
function storedShape(project: StoredProject | undefined): { name: string; boards: string[] } | undefined {
  if (!project) return undefined;
  const boards = project.projectData as { id: string; elements: unknown[] }[];
  return { name: project.name, boards: boards.map((board) => `${board.id}:${board.elements.length}`) };
}

/** The canvas, in the same shape. */
async function canvasShape(page: Page): Promise<{ projectId: string | null; name: string; boards: string[] }> {
  const status = await bridgeStatus(page);
  return {
    projectId: status.projectId,
    name: status.projectName,
    boards: status.artboards.map((board) => `${board.id}:${board.elements}`),
  };
}

async function openWithBridge(page: Page, board: typeof BOARD, name: string, id: string): Promise<void> {
  const opened = await page.evaluate(
    ({ data, projectName, projectId }) =>
      (
        window as unknown as {
          __osg: { loadProject: (d: unknown[], n: string, i: string) => Promise<boolean> };
        }
      ).__osg.loadProject(data, projectName, projectId),
    { data: [board], projectName: name, projectId: id }
  );
  expect(opened).toBe(true);
  await expect.poll(async () => (await bridgeStatus(page)).projectId).toBe(id);
}

/** Text elements added one tool call at a time, each seen on the canvas first. */
async function addTexts(page: Page, artboardId: string, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    const before = await elementCount(page);
    await callTool(page, 'add_element', {
      artboardId,
      type: 'text',
      content: `Line ${i + 1}`,
      fontSize: 30,
      color: '#ffffff',
      x: 40,
      y: 40 + i * 110,
      width: 900,
      height: 100,
    });
    await expect.poll(() => elementCount(page)).toBe(before + 1);
  }
}

/**
 * Send one design tool through the bridge without waiting for the answer. The
 * answer lands on `window.__E2E_CALL__` as "ok", "refused: ..." or "error: ...".
 */
async function sendTool(page: Page, name: string, args: Record<string, unknown>): Promise<void> {
  await page.evaluate(
    ({ toolName, toolArgs }) => {
      const scope = window as unknown as {
        __E2E_CALL__: { answer: string | null };
        __osg: { mcp: (m: unknown) => Promise<{ result?: { isError?: boolean; content?: { text?: string }[] }; error?: { message: string } }> };
      };
      scope.__E2E_CALL__ = { answer: null };
      void scope.__osg
        .mcp({ jsonrpc: '2.0', id: 99, method: 'tools/call', params: { name: toolName, arguments: toolArgs } })
        .then((response) => {
          scope.__E2E_CALL__.answer = response.error
            ? `error: ${response.error.message}`
            : response.result?.isError
              ? `refused: ${response.result.content?.[0]?.text ?? ''}`
              : 'ok';
        });
    },
    { toolName: name, toolArgs: args }
  );
}

function sendCreateArtboard(page: Page, name: string): Promise<void> {
  return sendTool(page, 'create_artboard', { name, width: 800, height: 400 });
}

function callAnswer(page: Page): Promise<string | null> {
  return page.evaluate(() => (window as unknown as { __E2E_CALL__?: { answer: string | null } }).__E2E_CALL__?.answer ?? null);
}

/**
 * Two stored projects, opened through the bridge with the left one last, so
 * the left one is on the canvas: the right one holds one text, the left three.
 */
async function openLeftAndRight(page: Page): Promise<{ left: typeof BOARD; right: typeof BOARD }> {
  const left = { ...BOARD, id: 'ab_left', name: 'Left board' };
  const right = { ...BOARD, id: 'ab_right', name: 'Right board', backgroundColor: '#6a1e3c' };
  await openWithBridge(page, right, 'Right project', 'proj_right');
  await addTexts(page, right.id, 1);
  await openWithBridge(page, left, 'Left project', 'proj_left');
  await addTexts(page, left.id, 3);
  await waitForProject(page, (project) => project.id === 'proj_left' && storedElementCount(project) === 3);
  await waitForProject(page, (project) => project.id === 'proj_right' && storedElementCount(project) === 1);
  return { left, right };
}

/**
 * Pick the right project under Recent projects with its read held, and wait
 * until the editor names it. The left one stays on the canvas until the hold
 * ends, and until then readProjects waits too, since it reads the same store.
 */
async function pickRightWhileHeld(editor: Editor, page: Page): Promise<ProjectsHold> {
  await editor.selectTemplateButton.click();
  await editor.waitForStartDialogReady();
  const row = editor.startDialog.getByText('Right project', { exact: true });
  await expect(row).toBeVisible();
  const hold = await holdProjects(page);
  await row.click();
  await expect.poll(async () => (await bridgeStatus(page)).projectId).toBe('proj_right');
  return hold;
}

/** Every stored version, as `<project id>:<label>`, sorted. */
async function storedVersions(page: Page): Promise<string[]> {
  const rows = await readAll<{ projectId: string; label: string }>(page, 'projectVersions');
  return rows.map((row) => `${row.projectId}:${row.label}`).sort();
}

/**
 * Four text elements, one tool call each, and each one seen on the canvas
 * before the next is sent. What happens to the four edits afterwards is what
 * the first two tests are about; the third sends its calls without the check.
 */
async function addFourTexts(page: Page, artboardId: string): Promise<void> {
  const before = await elementCount(page);
  for (let i = 0; i < 4; i++) {
    await callTool(page, 'add_element', {
      artboardId,
      type: 'text',
      content: `Line ${i + 1}`,
      fontSize: 30,
      color: '#ffffff',
      x: 40,
      y: 40 + i * 110,
      width: 900,
      height: 100,
    });
    await expect.poll(() => elementCount(page)).toBe(before + i + 1);
  }
}

test.describe('the headless bridge', () => {
  test('a project opened with loadProject keeps every edit, is stored under its id, and undoes', async ({ page }) => {
    // The editor's own warning when it looks for a project row that is not there.
    const missingRow: string[] = [];
    page.on('console', (message) => {
      if (/Project with ID .* not found/.test(message.text())) missingRow.push(message.text());
    });
    const editor = await openHeadless(page);

    const opened = await page.evaluate(
      (board) =>
        (
          window as unknown as {
            __osg: { loadProject: (data: unknown[], name: string, id: string) => Promise<boolean> };
          }
        ).__osg.loadProject([board], 'Bridge project', 'proj_bridge'),
      BOARD
    );
    expect(opened).toBe(true);

    // Edited as soon as the board has rendered, which is the earliest a tool
    // can find it.
    await expect.poll(async () => (await bridgeStatus(page)).artboards.length).toBe(1);
    await addFourTexts(page, BOARD.id);
    expect(await elementCount(page)).toBe(4);

    await page.waitForTimeout(SETTLE_MS);
    expect(await elementCount(page)).toBe(4);
    const status = await bridgeStatus(page);
    expect(status.projectId).toBe('proj_bridge');
    expect(status.projectName).toBe('Bridge project');
    expect(missingRow).toEqual([]);

    // Stored once, under the id it was opened with.
    const stored = await waitForProject(
      page,
      (project) => project.id === 'proj_bridge' && storedElementCount(project) === 4
    );
    expect(stored.name).toBe('Bridge project');
    expect(await readProjects(page)).toHaveLength(1);
    expect(page.url()).toContain('projectId=proj_bridge');

    // Undo steps back through the edits one at a time.
    await editor.undoButton.click();
    await expect.poll(() => elementCount(page)).toBe(3);
    await editor.redoButton.click();
    await expect.poll(() => elementCount(page)).toBe(4);

    // A reload opens the stored project again.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await editor.waitForBoot();
    await expect(editor.artboards).toHaveCount(1);
    await expect(editor.elementsOn(0)).toHaveCount(4);
  });

  test('the first edit on an editor with no project starts one that keeps every later edit, and undoes', async ({ page }) => {
    const editor = await openHeadless(page);

    const board = (await callTool(page, 'create_artboard', {
      name: 'First board',
      width: 1024,
      height: 500,
    })) as { id: string };
    await expect.poll(async () => (await bridgeStatus(page)).artboards.length).toBe(1);
    await addFourTexts(page, board.id);

    await page.waitForTimeout(SETTLE_MS);
    expect(await elementCount(page)).toBe(4);
    const status = await bridgeStatus(page);
    expect(status.projectId).toBeTruthy();

    // The stored row matches the canvas, name included.
    const stored = await waitForProject(
      page,
      (project) => project.id === status.projectId && storedElementCount(project) === 4
    );
    expect(stored.name).toBe(status.projectName);

    // Undo steps back through the four texts and stops at the edit that
    // created the project, the way an opened project stops at the state it
    // opened in, so the saved project keeps its artboard.
    for (let left = 3; left >= 0; left--) {
      await editor.undoButton.click();
      await expect.poll(() => elementCount(page)).toBe(left);
    }
    await expect(editor.undoButton).toBeDisabled();
    expect((await bridgeStatus(page)).artboards).toHaveLength(1);
    await editor.dockTab('History').click();
    const historyPanel = page
      .locator('[role="tabpanel"][data-state="active"]')
      .filter({ has: page.getByText('States', { exact: true }) });
    await expect(historyPanel.getByText(/^\d+ of \d+$/)).toHaveText('1 of 5');
    await expect(historyPanel.getByTitle('Current state')).toContainText('Add Artboard');
    await waitForProject(
      page,
      (project) =>
        project.id === status.projectId &&
        (project.projectData as unknown[]).length === 1 &&
        storedElementCount(project) === 0
    );
  });

  test('calls sent from inside the page one after another keep every edit', async ({ page }) => {
    await openHeadless(page);

    // The way a script running in the page drives the bridge: open, then each
    // call the moment the one before it answers, with nothing in between that
    // lets the editor render.
    const answers = await page.evaluate(async (board) => {
      const bridge = (
        window as unknown as {
          __osg: {
            loadProject: (data: unknown[], name: string, id: string) => Promise<boolean>;
            mcp: (message: unknown) => Promise<{ result?: { isError?: boolean }; error?: unknown }>;
          };
        }
      ).__osg;
      if (!(await bridge.loadProject([board], 'Bridge loop', 'proj_bridge_loop'))) return ['not opened'];
      const results: string[] = [];
      for (let i = 0; i < 10; i++) {
        const response = await bridge.mcp({
          jsonrpc: '2.0',
          id: i + 1,
          method: 'tools/call',
          params: {
            name: 'add_element',
            arguments: {
              artboardId: board.id,
              type: 'text',
              content: `Line ${i + 1}`,
              fontSize: 20,
              color: '#ffffff',
              x: 40,
              y: 20 + i * 45,
              width: 900,
              height: 40,
            },
          },
        });
        results.push(response.error || response.result?.isError ? 'refused' : 'ok');
      }
      return results;
    }, BOARD);
    expect(answers).toEqual(Array(10).fill('ok'));

    await expect.poll(() => elementCount(page)).toBe(10);
    await page.waitForTimeout(SETTLE_MS);
    expect(await elementCount(page)).toBe(10);
    await waitForProject(
      page,
      (project) => project.id === 'proj_bridge_loop' && storedElementCount(project) === 10
    );
  });

  test('a call sent while a reload is still reading the project waits for it, and the project keeps its artboards', async ({ page }) => {
    const editor = await openHeadless(page);
    await openWithBridge(page, BOARD, 'Reloaded project', 'proj_reload');
    await addTexts(page, BOARD.id, 3);
    await waitForProject(page, (project) => project.id === 'proj_reload' && storedElementCount(project) === 3);

    // An agent that keeps calling across a reload. On the next load the
    // project store is held from the first moment, so the editor's read of
    // ?projectId waits until the test lets it go, and create_artboard goes
    // out as soon as the bridge exists.
    await page.addInitScript(() => {
      if (sessionStorage.getItem('e2e-reload-race') !== 'armed') return;
      sessionStorage.setItem('e2e-reload-race', 'used');
      type Answer = { result?: { isError?: boolean; content?: { text?: string }[] }; error?: { message: string } };
      type Bridge = { status(): { projectId: string | null; artboards: unknown[] }; mcp(m: unknown): Promise<Answer> };
      const race = {
        release: false,
        sentWith: null as null | { projectId: string | null; boards: number },
        answer: null as string | null,
      };
      (window as unknown as { __E2E_RACE__: typeof race }).__E2E_RACE__ = race;
      const open = indexedDB.open('ProjectDatabase');
      open.onsuccess = () => {
        const db = open.result;
        const store = db.transaction('projects', 'readwrite').objectStore('projects');
        const spin = () => {
          if (race.release) db.close();
          else store.get('__e2e_hold__').onsuccess = spin;
        };
        spin();
      };
      let bridge: Bridge | undefined;
      Object.defineProperty(window, '__osg', {
        configurable: true,
        get: () => bridge,
        set(value: Bridge | undefined) {
          bridge = value;
          if (!value || race.sentWith) return;
          setTimeout(() => {
            const status = value.status();
            race.sentWith = { projectId: status.projectId, boards: status.artboards.length };
            void value
              .mcp({
                jsonrpc: '2.0',
                id: 1,
                method: 'tools/call',
                params: { name: 'create_artboard', arguments: { name: 'Sent during the reload', width: 800, height: 400 } },
              })
              .then((response) => {
                race.answer = response.error
                  ? `error: ${response.error.message}`
                  : response.result?.isError
                    ? `refused: ${response.result.content?.[0]?.text ?? ''}`
                    : 'ok';
              });
          }, 0);
        },
      });
    });
    await page.evaluate(() => sessionStorage.setItem('e2e-reload-race', 'armed'));
    await page.reload({ waitUntil: 'domcontentloaded' });

    type Race = { sentWith: { projectId: string | null; boards: number } | null; answer: string | null };
    const race = () => page.evaluate(() => (window as unknown as { __E2E_RACE__?: Race }).__E2E_RACE__ ?? null);
    await expect.poll(async () => (await race())?.sentWith ?? null, { timeout: 60_000 }).not.toBeNull();
    // The race: the editor named the project, and its canvas was still empty.
    expect((await race())?.sentWith).toEqual({ projectId: 'proj_reload', boards: 0 });

    // The call waits for the project instead of landing on the empty canvas.
    await page.waitForTimeout(1_000);
    expect((await race())?.answer).toBeNull();
    await page.evaluate(() => {
      (window as unknown as { __E2E_RACE__: { release: boolean } }).__E2E_RACE__.release = true;
    });
    await expect.poll(async () => (await race())?.answer ?? null, { timeout: 30_000 }).toBe('ok');

    await page.waitForTimeout(SETTLE_MS);
    const canvas = await canvasShape(page);
    expect(canvas.projectId).toBe('proj_reload');
    expect(canvas.name).toBe('Reloaded project');
    expect(canvas.boards).toHaveLength(2);
    expect(canvas.boards[0]).toBe(`${BOARD.id}:3`);
    const stored = (await readProjects(page)).find((project) => project.id === 'proj_reload');
    expect(storedShape(stored)).toEqual({ name: 'Reloaded project', boards: canvas.boards });

    // The next reload opens exactly that.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await editor.waitForBoot();
    await expect(editor.artboards).toHaveCount(2);
    await expect.poll(async () => (await canvasShape(page)).boards).toEqual(canvas.boards);
    expect((await bridgeStatus(page)).projectName).toBe('Reloaded project');
  });

  test('while Recent projects opens another project, an undo and a Delete change nothing and a call waits for that project', async ({ page }) => {
    const editor = await openHeadless(page);
    const left = { ...BOARD, id: 'ab_left', name: 'Left board' };
    const right = { ...BOARD, id: 'ab_right', name: 'Right board', backgroundColor: '#6a1e3c' };
    await openWithBridge(page, right, 'Right project', 'proj_right');
    await addTexts(page, right.id, 1);
    await openWithBridge(page, left, 'Left project', 'proj_left');
    await addTexts(page, left.id, 3);
    await waitForProject(page, (project) => project.id === 'proj_left' && storedElementCount(project) === 3);
    await waitForProject(page, (project) => project.id === 'proj_right' && storedElementCount(project) === 1);
    const before = new Map((await readProjects(page)).map((project) => [project.id, storedShape(project)]));

    // A text on the left board, selected the way a person selects it.
    const box = await editor.elementsOn(0).first().boundingBox();
    if (!box) throw new Error('The text has no bounding box');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(editor.selectedElement).toHaveCount(1);

    // Pick the other project under Recent projects, with its read held.
    await editor.selectTemplateButton.click();
    await editor.waitForStartDialogReady();
    const row = editor.startDialog.getByText('Right project', { exact: true });
    await expect(row).toBeVisible();
    const hold = await holdProjects(page);
    await row.click();
    await expect.poll(async () => (await bridgeStatus(page)).projectId).toBe('proj_right');
    // Named, not on the canvas yet: the canvas still holds the project being left.
    expect((await canvasShape(page)).boards).toEqual([`${left.id}:3`]);
    await expect(editor.selectedElement).toHaveCount(1);

    // Undo now would put the left project's previous state on the canvas and
    // save it under the right project's id. Delete would take the selected
    // text out of the left project's artboards and save them there as well,
    // and a call now would do the same with its own edit. None of them may
    // land, and Delete may not say that it did.
    await editor.undoButton.click();
    await page.keyboard.press('Delete');
    await sendCreateArtboard(page, 'Sent while opening');
    await page.waitForTimeout(1_000);
    expect(await callAnswer(page)).toBeNull();
    expect((await canvasShape(page)).boards).toEqual([`${left.id}:3`]);
    // Counted now rather than waited on: a toast closes by itself after a few
    // seconds, so waiting for none would pass even after one said "deleted".
    expect(await page.getByText('Element deleted', { exact: true }).count()).toBe(0);
    await expect(editor.selectedElement).toHaveCount(1);

    await hold.release();
    await expect.poll(() => callAnswer(page), { timeout: 30_000 }).toBe('ok');
    await page.waitForTimeout(SETTLE_MS);

    // The call went to the project that opened, and the one left is untouched.
    const canvas = await canvasShape(page);
    expect(canvas.projectId).toBe('proj_right');
    expect(canvas.name).toBe('Right project');
    expect(canvas.boards).toHaveLength(2);
    expect(canvas.boards[0]).toBe(`${right.id}:1`);
    const after = new Map((await readProjects(page)).map((project) => [project.id, storedShape(project)]));
    expect(after.get('proj_left')).toEqual(before.get('proj_left'));
    expect(after.get('proj_right')).toEqual({ name: 'Right project', boards: canvas.boards });
  });

  test('while Recent projects opens another project, a rename and Save this state are turned down and say why', async ({ page }) => {
    const editor = await openHeadless(page);
    const { left, right } = await openLeftAndRight(page);
    await editor.dockTab('Versions').click();
    const versionsBefore = await storedVersions(page);

    const hold = await pickRightWhileHeld(editor, page);
    expect((await canvasShape(page)).boards).toEqual([`${left.id}:3`]);

    // The name field still shows the project on the canvas, while the editor
    // already names the one being read. A rename now would be written to the
    // row being read, and the name that read brings back would replace it.
    const nameField = page.getByTitle('Double-click to rename project');
    const nameInput = page.getByPlaceholder('Project name...');
    await expect(nameField).toContainText('Left project');
    await nameField.dblclick();
    await nameInput.fill('Renamed while opening');
    await nameInput.press('Enter');
    await expect(page.getByText('The project was not renamed', { exact: true }).first()).toBeVisible();
    await expect(
      page.getByText('A project is still opening. Try again once it is open.', { exact: true }).first()
    ).toBeVisible();
    await expect(nameField).toContainText('Left project');

    // A named version would keep the left project's canvas as one of the
    // right project's versions, so none is kept, and the toast says so.
    const versionsPanel = page
      .locator('[role="tabpanel"][data-state="active"]')
      .filter({ has: page.getByText('Versions', { exact: true }) });
    await versionsPanel.getByRole('button', { name: 'Save this state' }).click();
    const versionName = versionsPanel.getByPlaceholder('Name this version');
    await versionName.fill('Saved while opening');
    await versionName.press('Enter');
    await expect(page.getByText('The version was not saved', { exact: true }).first()).toBeVisible();
    // Counted now rather than waited on: a toast closes by itself after a few
    // seconds, so waiting for none would pass even after one said "saved".
    expect(await page.getByText('Version saved', { exact: true }).count()).toBe(0);
    expect(await page.getByText('Project renamed', { exact: true }).count()).toBe(0);
    expect(await storedVersions(page)).toEqual(versionsBefore);

    // The right project opens under its own name, and its next edit writes
    // that name back, so neither row took the rename.
    await hold.release();
    await expect.poll(async () => (await canvasShape(page)).boards).toEqual([`${right.id}:1`]);
    await expect(nameField).toContainText('Right project');
    await addTexts(page, right.id, 1);
    await waitForProject(page, (project) => project.id === 'proj_right' && storedElementCount(project) === 2);
    const names = new Map((await readProjects(page)).map((project) => [project.id, project.name]));
    expect(names.get('proj_left')).toBe('Left project');
    expect(names.get('proj_right')).toBe('Right project');
    expect((await storedVersions(page)).filter((version) => version.endsWith(':Saved while opening'))).toEqual([]);

    // Once it is open, a rename lands on it.
    await nameField.dblclick();
    await nameInput.fill('Right project renamed');
    await nameInput.press('Enter');
    await expect(nameField).toContainText('Right project renamed');
    await waitForProject(page, (project) => project.id === 'proj_right' && project.name === 'Right project renamed');
    expect((await readProjects(page)).find((project) => project.id === 'proj_left')?.name).toBe('Left project');
  });

  test('while Recent projects opens another project, Duplicate on its row copies that project, not the canvas', async ({ page }) => {
    const editor = await openHeadless(page);
    const { left } = await openLeftAndRight(page);
    const hold = await pickRightWhileHeld(editor, page);
    expect((await canvasShape(page)).boards).toEqual([`${left.id}:3`]);

    // The canvas still holds the left project, so a copy of the right one
    // has to come from its stored row.
    await editor.selectTemplateButton.click();
    await editor.waitForStartDialogReady();
    await editor.startDialog.getByTitle('Duplicate "Right project"').click();
    await hold.release();

    await expect
      .poll(async () => (await bridgeStatus(page)).projectName, { timeout: 30_000 })
      .toBe('Right project copy');
    await expect.poll(() => elementCount(page)).toBe(1);
    const rows = await readProjects(page);
    expect(rows.map((project) => project.name).sort()).toEqual(['Left project', 'Right project', 'Right project copy']);
    const copy = rows.find((project) => project.name === 'Right project copy') as StoredProject;
    expect(storedElementCount(copy)).toBe(1);
  });

  test('an edit made to a project while the bridge opens another one is kept when the opened one is edited at once', async ({ page }) => {
    await openHeadless(page);
    const left = { ...BOARD, id: 'ab_left', name: 'Left board' };
    const right = { ...BOARD, id: 'ab_right', name: 'Right board', backgroundColor: '#6a1e3c' };
    await openWithBridge(page, right, 'Right project', 'proj_right');
    await openWithBridge(page, left, 'Left project', 'proj_left');
    await addTexts(page, left.id, 3);
    await waitForProject(page, (project) => project.id === 'proj_left' && storedElementCount(project) === 3);

    // The bridge opens the right project, which waits on the held store while
    // the left one is still on the canvas and still the open project.
    const hold = await holdProjects(page);
    await page.evaluate((board) => {
      const scope = window as unknown as {
        __E2E_OPENED__: boolean | null;
        __osg: { loadProject: (data: unknown[], name: string, id: string) => Promise<boolean> };
      };
      scope.__E2E_OPENED__ = null;
      void scope.__osg.loadProject([board], 'Right project', 'proj_right').then((opened) => {
        scope.__E2E_OPENED__ = opened;
      });
    }, right);

    // An edit to the left project lands meanwhile, and the editor answers it as
    // done. Its save is held back, so it is still waiting when the right
    // project's first edit comes below.
    const stretched = await stretchSaveDelay(page, () =>
      callTool(page, 'add_element', {
        artboardId: left.id,
        type: 'text',
        content: 'Line 4',
        fontSize: 30,
        color: '#ffffff',
        x: 40,
        y: 370,
        width: 900,
        height: 100,
      })
    );
    expect(stretched, 'no save was stretched, so SAVE_DELAY_MS no longer matches the editor').toBeGreaterThan(0);
    expect((await canvasShape(page)).boards).toEqual([`${left.id}:4`]);

    // The right project goes onto the canvas and is edited straight away,
    // while the left project's save is still waiting.
    await hold.release();
    await expect.poll(async () => (await canvasShape(page)).boards).toEqual([`${right.id}:0`]);
    await callTool(page, 'add_element', {
      artboardId: right.id,
      type: 'text',
      content: 'First on the right',
      fontSize: 30,
      color: '#ffffff',
      x: 40,
      y: 40,
      width: 900,
      height: 100,
    });
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __E2E_OPENED__: boolean | null }).__E2E_OPENED__))
      .toBe(true);

    // Each project keeps its own edits.
    await waitForProject(page, (project) => project.id === 'proj_left' && storedElementCount(project) === 4);
    await waitForProject(page, (project) => project.id === 'proj_right' && storedElementCount(project) === 1);
    expect(storedShape((await readProjects(page)).find((project) => project.id === 'proj_left'))).toEqual({
      name: 'Left project',
      boards: [`${left.id}:4`],
    });
  });

  test('a translation that finishes after another project opened is not saved, and translate_locales says so', async ({
    page,
    isDesktop,
  }) => {
    test.skip(isDesktop, 'The desktop app calls a custom AI endpoint through Rust, which the test runtime does not answer');
    // A translation engine: an OpenAI-compatible endpoint on this origin,
    // answered by the route below once the test lets it.
    await page.addInitScript(() => {
      localStorage.setItem(
        'open-screenshot-generator.ai-settings',
        JSON.stringify({
          provider: 'openai',
          keys: { openai: 'sk-e2e' },
          models: { openai: 'e2e-model' },
          baseUrls: { openai: `${location.origin}/__e2e_ai__/v1` },
          compatibleKeys: {},
        })
      );
    });
    let answerTranslation = () => {};
    const translationAnswered = new Promise<void>((resolve) => {
      answerTranslation = () => resolve();
    });
    let translationRequests = 0;
    await page.route('**/__e2e_ai__/v1/chat/completions', async (route) => {
      translationRequests += 1;
      const body = route.request().postDataJSON() as { messages?: { content: unknown }[] };
      const prompt = (body.messages ?? [])
        .map(({ content }) =>
          typeof content === 'string'
            ? content
            : Array.isArray(content)
              ? content.map((part: { text?: string }) => part.text ?? '').join('')
              : ''
        )
        .join('\n');
      const ids = [...prompt.matchAll(/"(s\d+)":/g)].map((match) => match[1]);
      await translationAnswered;
      await route.fulfill({
        json: {
          id: 'chatcmpl-e2e',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: 'e2e-model',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: JSON.stringify(Object.fromEntries(ids.map((id) => [id, `Übersetzt ${id}`]))),
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        },
      });
    });

    await openHeadless(page);
    const left = { ...BOARD, id: 'ab_left', name: 'Left board' };
    const right = { ...BOARD, id: 'ab_right', name: 'Right board', backgroundColor: '#6a1e3c' };
    await openWithBridge(page, right, 'Right project', 'proj_right');
    await openWithBridge(page, left, 'Left project', 'proj_left');
    await addTexts(page, left.id, 1);
    await callTool(page, 'add_locales', { locales: ['de-DE'], machineTranslate: false });
    await waitForProject(
      page,
      (project) =>
        project.id === 'proj_left' &&
        (project.projectData as { localization?: { locales: { code: string }[] } }[])[0]?.localization?.locales.some(
          (entry) => entry.code === 'de-DE'
        ) === true
    );
    const before = new Map((await readProjects(page)).map((project) => [project.id, JSON.stringify(project.projectData)]));

    // The agent asks for German, and the right project opens while the engine
    // is still working on the left project's text.
    await sendTool(page, 'translate_locales', { locales: ['de-DE'] });
    await expect.poll(() => translationRequests).toBe(1);
    await openWithBridge(page, right, 'Right project', 'proj_right');
    await expect.poll(async () => (await canvasShape(page)).boards).toEqual([`${right.id}:0`]);
    answerTranslation();

    // The translation of the left project is not written onto the right one,
    // and the agent is told that nothing was changed.
    await expect
      .poll(() => callAnswer(page), { timeout: 30_000 })
      .toMatch(/^refused: Another project was opened while this call ran, so nothing was changed\./);
    await page.waitForTimeout(SETTLE_MS);
    expect((await canvasShape(page)).boards).toEqual([`${right.id}:0`]);
    const after = new Map((await readProjects(page)).map((project) => [project.id, JSON.stringify(project.projectData)]));
    expect(after.get('proj_left')).toBe(before.get('proj_left'));
    expect(after.get('proj_right')).toBe(before.get('proj_right'));
    expect([...after.values()].join('')).not.toContain('Übersetzt');
  });

  test('a document with no artboards is not opened, and nothing is stored', async ({ page }) => {
    const editor = await openHeadless(page);

    const opened = await page.evaluate(() =>
      (
        window as unknown as {
          __osg: { loadProject: (data: unknown[], name: string, id: string) => Promise<boolean> };
        }
      ).__osg.loadProject([], 'Empty document', 'proj_empty_document')
    );
    expect(opened).toBe(false);

    const status = await bridgeStatus(page);
    expect(status.projectId).toBeNull();
    expect(status.artboards).toEqual([]);
    expect(await readProjects(page)).toEqual([]);
    expect(page.url()).not.toContain('projectId=');
    await expect(editor.startDialog).toBeVisible();

    // A document with an artboard still opens afterwards.
    await openWithBridge(page, BOARD, 'Real document', 'proj_real_document');
    await expect(editor.artboards).toHaveCount(1);
  });
});
