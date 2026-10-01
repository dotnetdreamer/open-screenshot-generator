import { test, expect, type Page } from '../fixtures/test';
import { TauriHarness } from '../fixtures/tauri';

/**
 * The Claude Code mode of the AI agent, the Agent panel it opens, and the code
 * folders a chat can read.
 *
 * Nothing here starts a real Claude Code. On the desktop project the IPC is the
 * mock in fixtures/tauri-runtime.ts, so a spec plays the process's side itself:
 * it answers `abs_claude_detect`, reads the lines the app writes with
 * `abs_claude_send`, replays stream-json output through the same event the
 * Rust side emits, and relays the agent's design tool calls the way Rust does.
 * What is under test is everything the app does with that: the tab, the
 * project it makes, the panel, what goes to stdin and what the tools allow.
 */

/** Must match EVENT in src-tauri/src/claude_code.rs. */
const CLAUDE_EVENT = 'abs-claude-event';
/** Must match MCP_REQUEST_EVENT in src-tauri/src/mcp_server.rs. */
const MCP_REQUEST_EVENT = 'abs-mcp-request';
/** What the IPC mock answers for abs_mcp_bridge_nonce; Rust stamps every event with it. */
const NONCE = 'e2e-bridge-nonce';
const SESSION = '6e6cdc77-0d28-43a0-955d-9cad1fb02032';
/** DESKTOP_DOWNLOAD_URL in agent/ClaudeCodeSetup.tsx. */
const DESKTOP_DOWNLOAD_URL = 'https://openscrgen.app';

/**
 * Everything the page may put in abs_claude_start. The system prompt and the
 * skills are built into the app, and Rust checks every folder path again.
 */
const START_KEYS = ['spawnId', 'model', 'resume', 'pageEpoch', 'folders'];
type StartArgs = { spawnId: string; model?: string; resume?: string; pageEpoch?: number; folders?: string[] };

/** Folders as Rust's picker hands them back: canonical paths, and the folder's own name. */
const MARBLY = { name: 'marbly', path: '/Users/e2e/code/marbly' };
const MARBLY_ANDROID = { name: 'marbly-android', path: '/Users/e2e/code/marbly-android' };
const MARBLY_WEB = { name: 'marbly-web', path: '/Users/e2e/code/marbly-web' };
const ADD_FOLDER = "Add your app's code folder";
/** WEB_LINKS_OFF in src/lib/mcp/desktopMcpServer.ts. */
const WEB_LINKS_OFF =
  'Web links are off in this chat because the agent has read a code folder. Use import_project_image or a picture the user attached';

const READY = {
  found: true,
  path: 'C:\\claude\\claude.exe',
  version: '2.1.202 (Claude Code)',
  loggedIn: true,
  authMethod: 'claude.ai',
  subscriptionType: 'max',
};

function agentDialog(page: Page) {
  return page.getByRole('dialog').filter({ hasText: 'Design with the AI agent' });
}

async function openAgentScreen(page: Page, startDialog: ReturnType<Page['getByRole']>) {
  await startDialog.getByRole('button', { name: /Start with the AI agent/i }).click();
  const dialog = agentDialog(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

async function waitForListener(tauri: TauriHarness, event: string) {
  await expect
    .poll(
      async () => (await tauri.callsTo('plugin:event|listen')).some((call) => call.args.event === event),
      { timeout: 30_000, message: `the app never subscribed to ${event}` }
    )
    .toBe(true);
}

/** Every stdin line the app has written so far, parsed. */
async function sentLines(tauri: TauriHarness): Promise<Array<Record<string, any>>> {
  return (await tauri.callsTo('abs_claude_send')).map((call) => JSON.parse(String(call.args.line)));
}

async function play(tauri: TauriHarness, spawnId: string, messages: unknown[]) {
  for (const message of messages) {
    await tauri.emitFromBackend(CLAUDE_EVENT, { spawnId, kind: 'stdout', line: JSON.stringify(message), nonce: NONCE });
  }
}

const init = (uuid: string) => ({
  type: 'system',
  subtype: 'init',
  session_id: SESSION,
  model: 'claude-opus-5-5',
  mcp_servers: [{ name: 'osg-editor', status: 'connected' }],
  apiKeySource: 'none',
  uuid,
});

const turnEnd = (uuid: string) => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'done',
  num_turns: 1,
  duration_ms: 500,
  session_id: SESSION,
  uuid,
});

/** The code folder chips, in the panel or on the start screen. */
function folderChips(scope: ReturnType<Page['locator']>) {
  return scope.getByRole('list', { name: 'Folders Claude Code can read' }).getByRole('listitem');
}

/** The start screen's code folder row. */
function folderRow(dialog: ReturnType<Page['locator']>) {
  return dialog.getByRole('group', { name: "Your app's code (Claude Code only)" });
}

/**
 * A notice line on screen. The live region that reads a notice out keeps its
 * last words after the line has gone, so it is left out.
 */
function noticeLine(scope: ReturnType<Page['locator']>, text: string) {
  return scope.getByText(text, { exact: true }).and(scope.locator(':not([role="status"])'));
}

/** Undo a setError, so the command answers again. */
async function clearError(page: Page, cmd: string) {
  await page.evaluate((name) => {
    const state = (window as unknown as { __E2E_TAURI__?: { config: { errors: Record<string, string> } } }).__E2E_TAURI__;
    if (state) delete state.config.errors[name];
  }, cmd);
}

/** Undo a setResponse, so the mock answers the command itself again. */
async function clearResponse(page: Page, cmd: string) {
  await page.evaluate((name) => {
    const state = (window as unknown as { __E2E_TAURI__?: { config: { responses: Record<string, unknown> } } }).__E2E_TAURI__;
    if (state) delete state.config.responses[name];
  }, cmd);
}

let mcpCalls = 0;

/**
 * One tools/call through the bridge, the way Rust relays it. `agent` is what
 * Rust works out from the request's bearer token: whether it came from the
 * app's own Claude Code. `folders` is Rust's word, stamped on an agent
 * request, that a process it runs can read a code folder; left out, the
 * payload has no such field.
 */
async function mcpCall(
  tauri: TauriHarness,
  name: string,
  args: Record<string, unknown>,
  agent: boolean,
  folders?: boolean
) {
  const id = ++mcpCalls;
  const callId = `e2e-call-${id}`;
  await tauri.emitFromBackend(MCP_REQUEST_EVENT, {
    callId,
    nonce: NONCE,
    agent,
    ...(folders === undefined ? {} : { folders }),
    message: { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } },
  });
  const reply = async () => (await tauri.callsTo('abs_mcp_respond')).find((call) => call.args.callId === callId);
  await expect.poll(async () => !!(await reply()), { timeout: 30_000, message: `${name} was never answered` }).toBe(true);
  const response = (await reply())!.args.response as {
    result?: { isError?: boolean; content?: Array<{ text?: string }> };
  };
  return { isError: response.result?.isError === true, text: response.result?.content?.[0]?.text ?? '' };
}

/**
 * Whether this browser can put a Blob into IndexedDB, where an imported
 * picture is stored. Playwright's WebKit cannot (history-versions.spec.ts has
 * the details); the WKWebView a desktop release ships in can.
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

/**
 * Record `window.open` instead of letting a popup happen: openExternal() on
 * the web is a window.open call, and the hermetic guard would abort the page
 * it opened.
 */
async function recordWindowOpen(page: Page): Promise<() => Promise<string[]>> {
  await page.evaluate(() => {
    const opened: string[] = [];
    (window as unknown as { __E2E_OPENED__: string[] }).__E2E_OPENED__ = opened;
    window.open = ((url?: string | URL) => {
      opened.push(String(url ?? ''));
      return null;
    }) as typeof window.open;
  });
  return () => page.evaluate(() => (window as unknown as { __E2E_OPENED__?: string[] }).__E2E_OPENED__ ?? []);
}

test.describe('the Claude Code tab', () => {
  test('leads the agent screen, with its logo, on both builds', async ({ app, page, isDesktop, tauri }) => {
    const dialog = await openAgentScreen(page, app.startDialog);
    const tab = dialog.getByRole('tab', { name: 'Claude Code' });
    await expect(dialog.getByRole('tab').first()).toHaveText('Claude Code');
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect(tab.locator('svg')).toBeVisible();

    if (isDesktop) {
      // The mock reports no Claude Code, so the tab explains how to get it.
      await tauri.waitForCall('abs_claude_detect');
      await expect(dialog.getByText('Claude Code is not installed')).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Check again' })).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Start with Claude Code' })).toBeDisabled();
      expect(await tauri.unhandled()).toEqual([]);
    } else {
      await expect(dialog.getByText('Claude Code runs in the desktop app')).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Start with Claude Code' })).toHaveCount(0);
      expect(await page.evaluate(() => '__TAURI_INTERNALS__' in window)).toBe(false);
    }
  });

  test('the other modes are still there, after it', async ({ app, page }) => {
    const dialog = await openAgentScreen(page, app.startDialog);
    await expect(dialog.getByRole('tab', { name: 'Free, use my account' })).toBeVisible();
    await expect(dialog.getByRole('tab', { name: 'Use my API key' })).toBeVisible();
  });
});

test.describe('a Claude Code run', () => {
  test.use({ tauriConfig: { responses: { abs_claude_detect: READY } } });

  test('makes a project, opens the Agent panel and keeps the chat going', async ({ app, page, tauri, isDesktop }) => {
    test.skip(!isDesktop, 'Claude Code runs in the desktop app');

    const dialog = await openAgentScreen(page, app.startDialog);
    await expect(dialog.getByText('Claude Code 2.1.202 is ready')).toBeVisible();
    await expect(dialog.getByText('Uses your Claude Max plan')).toBeVisible();
    await page.locator('#agent-instruction').fill('Dark set for a habit tracker called Droply');
    await dialog.getByRole('button', { name: 'Start with Claude Code' }).click();

    // The dialog closes onto a new, empty project, with the chat in the dock.
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expect(app.artboards).toHaveCount(1);
    const agentTab = page.getByRole('tab', { name: 'Agent', exact: true });
    await expect(agentTab).toHaveAttribute('aria-selected', 'true');
    // First in the strip, ahead of Properties.
    await expect(agentTab.locator('..').getByRole('tab').first()).toHaveText('Agent');
    const panel = app.activeDockPanel;

    // The listener goes up before the process, so its first lines are not lost.
    await waitForListener(tauri, CLAUDE_EVENT);
    const start = await tauri.waitForCall('abs_claude_start');
    const calls = await tauri.calls();
    const listenAt = calls.findIndex((call) => call.cmd === 'plugin:event|listen' && call.args.event === CLAUDE_EVENT);
    expect(listenAt).toBeLessThan(calls.findIndex((call) => call.cmd === 'abs_claude_start'));
    // The page picks the process, the model and the conversation, says which
    // page load it is and names the chat's code folders, nothing else: the
    // system prompt and the skills are built into the app. This chat has no
    // folder, so the start carries none.
    const args = start.args.args as StartArgs;
    expect(START_KEYS).toEqual(expect.arrayContaining(Object.keys(args)));
    expect(args.resume).toBeUndefined();
    expect(args.pageEpoch).toBe(1);
    expect(args.folders).toBeUndefined();
    const spawnId = args.spawnId;

    // The first message: the brief naming the new project, then the words.
    await expect.poll(async () => (await sentLines(tauri)).length).toBe(1);
    const [first] = await sentLines(tauri);
    expect(first.type).toBe('user');
    expect(first.session_id).toBe('');
    const firstText = first.message.content[0].text as string;
    expect(firstText).toContain('"Droply screenshots"');
    expect(firstText).toContain('Dark set for a habit tracker called Droply');
    expect(firstText).not.toContain('<editor-context>');
    await expect(panel.getByText('Dark set for a habit tracker called Droply')).toBeVisible();
    await expect(panel.getByText('Working...').first()).toBeVisible();

    // The process answers: a reply, a tool call and its result, then the end of the turn.
    await play(tauri, spawnId, [
      init('i1'),
      {
        type: 'assistant',
        uuid: 'a1',
        message: {
          id: 'm1',
          content: [{ type: 'text', text: 'Starting with a **dark** template, as [the guidelines](https://developer.apple.com/app-store/) suggest.' }],
        },
      },
      {
        type: 'assistant',
        uuid: 'a2',
        message: { id: 'm1', content: [{ type: 'tool_use', id: 'tu1', name: 'mcp__osg-editor__list_artboards', input: {} }] },
      },
      { type: 'user', uuid: 'u1', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: [{ type: 'text', text: '[]' }] }] } },
      { type: 'result', subtype: 'success', is_error: false, result: 'done', num_turns: 2, duration_ms: 1200, session_id: '6e6cdc77-0d28-43a0-955d-9cad1fb02032', uuid: 'r1' },
    ]);
    await expect(panel.getByText('dark', { exact: true })).toBeVisible();
    // A chat with no code folder keeps a link a link.
    await expect(panel.getByRole('link', { name: 'the guidelines' })).toHaveAttribute('href', 'https://developer.apple.com/app-store/');
    await expect(panel.getByText('Looked at the artboards')).toBeVisible();
    await expect(panel.getByText('Opus 5.5')).toBeVisible();

    // A follow-up from the panel goes to the same process, with the context.
    const input = panel.getByLabel('Message the agent');
    await input.fill('Make the headline bigger');
    await panel.getByRole('button', { name: 'Send' }).click();
    await expect.poll(async () => (await sentLines(tauri)).length).toBe(2);
    const second = (await sentLines(tauri))[1];
    const secondText = second.message.content[0].text as string;
    expect(secondText).toMatch(/^<editor-context>/);
    expect(secondText.endsWith('Make the headline bigger')).toBe(true);
    expect(await tauri.callsTo('abs_claude_start')).toHaveLength(1);

    // Stop interrupts the turn over stdin rather than killing the process.
    await play(tauri, spawnId, [
      init('i2'),
      { type: 'assistant', uuid: 'a3', message: { id: 'm2', content: [{ type: 'tool_use', id: 'tu2', name: 'mcp__osg-editor__update_element', input: { content: 'Track every drop' } }] } },
    ]);
    await expect(panel.getByText('Editing an element...')).toBeVisible();
    // Stop takes the Send button's place, so the second click of a double
    // click on Send lands on it. That click (detail 2) must not cancel the
    // message it just sent.
    const stopButton = panel.getByRole('button', { name: 'Stop' });
    await stopButton.dispatchEvent('click', { detail: 2 });
    expect((await sentLines(tauri)).at(-1)?.type).toBe('user');
    await expect(stopButton).toBeVisible();
    await stopButton.click();
    await expect.poll(async () => (await sentLines(tauri)).at(-1)?.type).toBe('control_request');
    expect((await sentLines(tauri)).at(-1)?.request).toEqual({ subtype: 'interrupt' });
    await play(tauri, spawnId, [
      { type: 'result', subtype: 'error_during_execution', is_error: true, result: 'undefined', terminal_reason: 'aborted_streaming', uuid: 'r2' },
    ]);
    await expect(panel.getByText('Stopped', { exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Send' })).toBeVisible();
    expect(await tauri.callsTo('abs_claude_stop')).toHaveLength(0);

    // A new chat ends the process and empties the transcript.
    await panel.getByRole('button', { name: 'Start a new chat' }).click();
    await tauri.waitForCall('abs_claude_stop');
    await expect(panel.getByText('Talk to the agent')).toBeVisible();

    expect(await tauri.unhandled()).toEqual([]);
  });

  test('past chats come back and resume, and every project gets a chat of its own', async ({ app, page, tauri, isDesktop }) => {
    test.skip(!isDesktop, 'Claude Code runs in the desktop app');

    const dialog = await openAgentScreen(page, app.startDialog);
    await page.locator('#agent-instruction').fill('Dark set for a habit tracker called Droply');
    await dialog.getByRole('button', { name: 'Start with Claude Code' }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    const droplyProject = await expect
      .poll(() => new URL(page.url()).searchParams.get('projectId'))
      .not.toBeNull()
      .then(() => new URL(page.url()).searchParams.get('projectId'));
    const panel = app.activeDockPanel;
    await waitForListener(tauri, CLAUDE_EVENT);
    const first = (await tauri.waitForCall('abs_claude_start')).args.args as { spawnId: string };
    await expect.poll(async () => (await sentLines(tauri)).length).toBe(1);
    await play(tauri, first.spawnId, [
      init('i1'),
      { type: 'assistant', uuid: 'a1', message: { id: 'm1', content: [{ type: 'text', text: 'Droply is ready.' }] } },
      turnEnd('r1'),
    ]);
    await expect(panel.getByText('Droply is ready.')).toBeVisible();

    // A new chat keeps the old one, listed under this project.
    await panel.getByRole('button', { name: 'Start a new chat' }).click();
    await expect(panel.getByText('Talk to the agent')).toBeVisible();
    const pastChats = panel.getByRole('button', { name: 'Past chats' });
    await pastChats.click();
    await expect(pastChats).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.getByText('This project')).toBeVisible();
    const droplyChat = panel.getByRole('button', { name: /Dark set for a habit tracker called Droply/ });
    await droplyChat.click();

    // Back on screen, and the next message resumes that conversation.
    await expect(panel.getByText('Droply is ready.')).toBeVisible();
    await panel.getByLabel('Message the agent').fill('Make the headline bigger');
    await panel.getByRole('button', { name: 'Send' }).click();
    await expect.poll(async () => (await tauri.callsTo('abs_claude_start')).length).toBe(2);
    const second = (await tauri.callsTo('abs_claude_start'))[1].args.args as StartArgs;
    expect(second.resume).toBe(SESSION);
    await play(tauri, second.spawnId, [init('i2'), turnEnd('r2')]);
    await expect(panel.getByRole('button', { name: 'Send' })).toBeVisible();

    // Another project gets an empty chat of its own...
    await app.selectTemplateButton.click();
    await app.startBlankProject();
    await expect.poll(() => new URL(page.url()).searchParams.get('projectId')).not.toBe(droplyProject);
    await expect(panel.getByText('Talk to the agent')).toBeVisible();

    // ...and Past chats goes back to the Droply chat and its project.
    await pastChats.click();
    await expect(panel.getByText(/Droply screenshots · /)).toBeVisible();
    await panel.getByRole('button', { name: /Dark set for a habit tracker called Droply/ }).click();
    await expect(panel.getByText('Droply is ready.')).toBeVisible();
    await expect.poll(() => new URL(page.url()).searchParams.get('projectId')).toBe(droplyProject);
    await expect(panel.getByText('Make the headline bigger')).toBeVisible();

    expect(await tauri.unhandled()).toEqual([]);
  });

  test('an open project can reach the agent from the dock, and the tab can go away again', async ({
    app,
    page,
    tauri,
    isDesktop,
  }) => {
    test.skip(!isDesktop, 'Claude Code runs in the desktop app');

    await app.startBlankProject();
    const agentTab = page.getByRole('tab', { name: 'Agent', exact: true });
    await expect(agentTab).toHaveCount(0);

    await app.chooseFromMenu(page.getByTitle('Panel and display options'), 'Chat with Claude Code');
    await expect(agentTab).toHaveAttribute('aria-selected', 'true');
    const panel = app.activeDockPanel;
    await expect(panel.getByText('Talk to the agent')).toBeVisible();
    await expect(panel.getByText('Uses your Claude Max plan')).toBeVisible();
    // Opening the tab asks whether Claude Code is still there; it starts nothing.
    await tauri.waitForCall('abs_claude_detect');
    expect(await tauri.callsTo('abs_claude_start')).toHaveLength(0);

    await app.chooseFromMenu(panel.getByRole('button', { name: 'Agent options' }), 'Hide this tab');
    await expect(agentTab).toHaveCount(0);
    await expect(app.dockTab('Properties')).toHaveAttribute('aria-selected', 'true');
    expect(await tauri.unhandled()).toEqual([]);
  });

  test('a press on the canvas takes the keyboard back from the chat', async ({ app, page, isDesktop }) => {
    test.skip(!isDesktop, 'Claude Code runs in the desktop app');

    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await app.addElementFrom('Basic', 'Rectangle', 'basic:rectangle');
    await app.chooseFromMenu(page.getByTitle('Panel and display options'), 'Chat with Claude Code');
    const panel = app.activeDockPanel;
    await expect(panel.getByText('Talk to the agent')).toBeVisible();

    // Focus left on a chat button (a pick from Agent options hands it back
    // there) and words selected in the chat. The canvas prevents the default
    // on pointerdown, so neither goes away by itself.
    await panel.getByRole('button', { name: 'Agent options' }).focus();
    await page.evaluate(() => {
      const heading = [...document.querySelectorAll('[data-agent-panel] *')].find(
        (node) => node.childElementCount === 0 && node.textContent?.trim() === 'Talk to the agent'
      );
      if (heading) window.getSelection()?.selectAllChildren(heading);
    });
    expect(await page.evaluate(() => window.getSelection()?.isCollapsed)).toBe(false);

    const box = await app.elementsOn(0).first().boundingBox();
    if (!box) throw new Error('The rectangle has no bounding box');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(app.selectedElement).toHaveCount(1);
    expect(await page.evaluate(() => !!document.activeElement?.closest('[data-agent-panel]'))).toBe(false);
    expect(await page.evaluate(() => window.getSelection()?.isCollapsed)).toBe(true);

    // Delete reaches the canvas instead of the chat button.
    await page.keyboard.press('Delete');
    await expect(app.elementsOn(0)).toHaveCount(0);
  });

  test('keys pressed in the chat stay there, and a closed menu gives them back', async ({ app, page, isDesktop }) => {
    test.skip(!isDesktop, 'Claude Code runs in the desktop app');

    await app.startBlankProject();
    await app.ensurePaletteOpen();
    await app.addElementFrom('Basic', 'Rectangle', 'basic:rectangle');
    const box = await app.elementsOn(0).first().boundingBox();
    if (!box) throw new Error('The rectangle has no bounding box');
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.click(centre.x, centre.y);
    await expect(app.selectedElement).toHaveCount(1);

    await app.chooseFromMenu(page.getByTitle('Panel and display options'), 'Chat with Claude Code');
    const panel = app.activeDockPanel;
    await expect(panel.getByText('Talk to the agent')).toBeVisible();

    // A click on the chat's own text focuses the tab panel wrapped around it.
    // A key pressed there belongs to the chat: Backspace must not delete the
    // selected layer.
    await panel.getByText('Talk to the agent').click();
    await page.keyboard.press('Backspace');
    await expect(app.elementsOn(0)).toHaveCount(1);

    // Agent options closed by a press on the canvas leaves nothing in the chat
    // focused, so the next key reaches the canvas again.
    await panel.getByRole('button', { name: 'Agent options' }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    await page.mouse.click(centre.x, centre.y);
    await expect(page.getByRole('menu')).toHaveCount(0);
    expect(await page.evaluate(() => !!document.activeElement?.closest('[data-agent-panel]'))).toBe(false);
    await expect(app.selectedElement).toHaveCount(1);
    await page.keyboard.press('Delete');
    await expect(app.elementsOn(0)).toHaveCount(0);
  });

  test('asking for Layers from the chat opens a tab that shows them', async ({ app, page, isDesktop }) => {
    test.skip(!isDesktop, 'Claude Code runs in the desktop app');

    await app.startBlankProject();
    await app.chooseFromMenu(page.getByTitle('Panel and display options'), 'Chat with Claude Code');
    await expect(page.getByRole('tab', { name: 'Agent', exact: true })).toHaveAttribute('aria-selected', 'true');
    // The chat takes the whole column while another tab is there to switch to.
    await expect(app.layersHeader).toHaveCount(0);

    await page.getByTitle('Collapse right panel').click();
    await page.getByTitle('Open Layers').click();
    await expect(app.dockTab('Properties')).toHaveAttribute('aria-selected', 'true');
    await expect(app.layersHeader).toBeVisible();
  });

  test('a process that dies says why', async ({ app, page, tauri, isDesktop }) => {
    test.skip(!isDesktop, 'Claude Code runs in the desktop app');

    const dialog = await openAgentScreen(page, app.startDialog);
    await page.locator('#agent-instruction').fill('Anything');
    await dialog.getByRole('button', { name: 'Start with Claude Code' }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    const start = await tauri.waitForCall('abs_claude_start');
    const spawnId = (start.args.args as { spawnId: string }).spawnId;

    // Another window emitting in Rust's name, without the nonce, is ignored.
    await tauri.emitFromBackend(CLAUDE_EVENT, { spawnId, kind: 'exit', code: 7, stderrTail: ['forged'] });
    await tauri.emitFromBackend(CLAUDE_EVENT, {
      spawnId,
      kind: 'exit',
      code: 1,
      stderrTail: ['Claude Code on Windows requires either Git for Windows (for bash) or PowerShell'],
      nonce: NONCE,
    });
    const panel = app.activeDockPanel;
    await expect(panel.getByText(/forged/)).toHaveCount(0);
    await expect(panel.getByText(/Claude Code stopped: Claude Code on Windows requires/)).toBeVisible();
    // An exit from some other process is not this chat's business.
    await tauri.emitFromBackend(CLAUDE_EVENT, { spawnId: 'someone-else', kind: 'exit', code: 9, nonce: NONCE });
    await expect(panel.getByText(/exit code 9/)).toHaveCount(0);
  });
});

test.describe('code folders', () => {
  test.use({ tauriConfig: { responses: { abs_claude_detect: READY }, codeFolder: MARBLY } });

  test('a folder added in the panel reaches the next start, and taking it off ends access at once', async ({
    app,
    page,
    tauri,
    isDesktop,
  }) => {
    test.skip(!isDesktop, 'code folders need the desktop app');

    await app.startBlankProject();
    await app.chooseFromMenu(page.getByTitle('Panel and display options'), 'Chat with Claude Code');
    const panel = app.activeDockPanel;
    await expect(panel.getByText('Talk to the agent')).toBeVisible();
    const chips = folderChips(panel);
    const input = panel.getByLabel('Message the agent');
    const send = panel.getByRole('button', { name: 'Send' });

    // Docked, the dialog belongs to the editor window, so the pick names no other.
    await panel.getByRole('button', { name: ADD_FOLDER }).click();
    await expect(chips).toHaveText([MARBLY.name]);
    expect((await tauri.callsTo('abs_claude_pick_folder')).map((call) => call.args)).toEqual([{}]);
    await expect(chips.first()).toHaveAttribute('title', `${MARBLY.path}\nClaude Code can read this folder but not change it`);
    await expect(input).toBeFocused();
    await expect(panel.getByRole('status')).toHaveText(`Added ${MARBLY.name}`);
    await expect(panel.getByRole('button', { name: 'Put my app icon on the first artboard' })).toBeVisible();
    // Nothing reaches Claude Code before a message.
    expect(await tauri.callsTo('abs_claude_start')).toHaveLength(0);

    // A folder the agent has not read yet is a message on its own.
    await expect(send).toBeEnabled();
    await send.click();
    const first = (await tauri.waitForCall('abs_claude_start')).args.args as StartArgs;
    expect(START_KEYS).toEqual(expect.arrayContaining(Object.keys(first)));
    expect(first.folders).toEqual([MARBLY.path]);
    await expect.poll(async () => (await sentLines(tauri)).length).toBe(1);
    const firstText = (await sentLines(tauri))[0].message.content[0].text as string;
    expect(firstText.endsWith('Use the folder I added')).toBe(true);
    // The first turn has nothing to compare with: the instructions list the folder.
    expect(firstText).not.toContain('app folders changed');
    await expect(panel.getByText('Use the folder I added')).toBeVisible();

    // A running turn still reads the folder, so it cannot be taken off yet.
    const removeMarbly = panel.getByRole('button', { name: `Remove the ${MARBLY.name} folder` });
    await expect(removeMarbly).toBeDisabled();
    await expect(removeMarbly).toHaveAttribute('title', 'Stop the agent to remove a folder');
    await removeMarbly.dispatchEvent('click');
    await expect(chips).toHaveText([MARBLY.name]);
    await play(tauri, first.spawnId, [
      init('i1'),
      {
        type: 'assistant',
        uuid: 'a1',
        message: { id: 'm1', content: [{ type: 'text', text: 'Marbly it is. More in [the listing](https://x.example/?d=Marbly).' }] },
      },
      turnEnd('r1'),
    ]);
    await expect(panel.getByText('Marbly it is.')).toBeVisible();
    // The agent could read the folder, so a link's address is written out,
    // with nothing to click.
    const address = panel.getByText('https://x.example/?d=Marbly', { exact: true });
    await expect(address).toBeVisible();
    await expect(panel.getByRole('link', { name: 'the listing' })).toHaveCount(0);
    await expect(removeMarbly).toBeEnabled();
    expect(await tauri.callsTo('abs_claude_stop')).toHaveLength(0);

    // A second folder means another process: the set is fixed when Claude
    // Code starts, so the next message restarts it with the conversation.
    await tauri.setResponse('abs_claude_pick_folder', MARBLY_ANDROID);
    await panel.getByRole('button', { name: ADD_FOLDER }).click();
    await expect(chips).toHaveText([MARBLY.name, MARBLY_ANDROID.name]);
    await input.fill('Put my app icon on the first artboard');
    await send.click();
    await expect.poll(async () => (await tauri.callsTo('abs_claude_start')).length).toBe(2);
    const second = (await tauri.callsTo('abs_claude_start'))[1].args.args as StartArgs;
    expect(second.resume).toBe(SESSION);
    expect(second.folders).toEqual([MARBLY.path, MARBLY_ANDROID.path].sort());
    expect((await tauri.callsTo('abs_claude_stop')).map((call) => call.args.spawnId)).toEqual([first.spawnId]);
    await expect.poll(async () => (await sentLines(tauri)).length).toBe(2);
    const secondText = (await sentLines(tauri))[1].message.content[0].text as string;
    expect(secondText).toContain("The user's app folders changed. Your instructions list the folders you can read now.");
    expect(secondText.endsWith('Put my app icon on the first artboard')).toBe(true);
    await play(tauri, second.spawnId, [init('i2'), turnEnd('r2')]);
    await expect(send).toBeVisible();

    // Between turns a removal stops the process that could read the folder
    // now, not on the next message, and Rust forgets a pick no chat holds.
    await removeMarbly.click();
    await expect(chips).toHaveText([MARBLY_ANDROID.name]);
    await expect
      .poll(async () => (await tauri.callsTo('abs_claude_stop')).map((call) => call.args.spawnId))
      .toEqual([first.spawnId, second.spawnId]);
    await expect
      .poll(async () => (await tauri.callsTo('abs_claude_forget_folder')).map((call) => call.args.path))
      .toEqual([MARBLY.path]);
    // Focus goes to the chip that took its place, then to the add button.
    const removeAndroid = panel.getByRole('button', { name: `Remove the ${MARBLY_ANDROID.name} folder` });
    await expect(removeAndroid).toBeFocused();
    await removeAndroid.click();
    await expect(chips).toHaveCount(0);
    await expect(panel.getByRole('button', { name: ADD_FOLDER })).toBeFocused();
    await expect
      .poll(async () => (await tauri.callsTo('abs_claude_forget_folder')).map((call) => call.args.path))
      .toEqual([MARBLY.path, MARBLY_ANDROID.path]);

    // With no folder left the start is the plain one, and the agent hears
    // that it can no longer read them.
    await input.fill('Carry on');
    await send.click();
    await expect.poll(async () => (await tauri.callsTo('abs_claude_start')).length).toBe(3);
    const third = (await tauri.callsTo('abs_claude_start'))[2].args.args as StartArgs;
    expect(Object.keys(third)).not.toContain('folders');
    expect(third.resume).toBe(SESSION);
    await expect.poll(async () => (await sentLines(tauri)).length).toBe(3);
    expect((await sentLines(tauri))[2].message.content[0].text).toContain(
      'The user removed their app folders, so you can no longer read them.'
    );
    // The conversation still holds what the agent read, so the link stays text.
    await expect(address).toBeVisible();
    await expect(panel.getByRole('link', { name: 'the listing' })).toHaveCount(0);
    expect(await tauri.unhandled()).toEqual([]);
  });

  test('the panel says why a folder was not added: a refusal, then the cap', async ({
    app,
    page,
    tauri,
    isDesktop,
  }) => {
    test.skip(!isDesktop, 'code folders need the desktop app');

    await app.startBlankProject();
    await app.chooseFromMenu(page.getByTitle('Panel and display options'), 'Chat with Claude Code');
    const panel = app.activeDockPanel;
    await expect(panel.getByText('Talk to the agent')).toBeVisible();
    const add = panel.getByRole('button', { name: ADD_FOLDER });
    const chips = folderChips(panel);
    const refusal = "That is a whole drive. Pick your app's own folder";
    const cap = 'You can add up to 3 folders. Remove one to add another';

    // Rust refuses with the sentence the user reads. The composer shows it,
    // and a screen reader hears it.
    await tauri.setError('abs_claude_pick_folder', refusal);
    await add.click();
    await expect(noticeLine(panel, refusal)).toBeVisible();
    await expect(panel.getByRole('status')).toHaveText(refusal);
    await expect(chips).toHaveCount(0);
    await clearError(page, 'abs_claude_pick_folder');

    // A cancel adds nothing, and opening the dialog again cleared the refusal.
    await expect(add).not.toHaveAttribute('aria-busy', 'true');
    await tauri.setResponse('abs_claude_pick_folder', null);
    await add.click();
    await expect(noticeLine(panel, refusal)).toHaveCount(0);
    await expect(chips).toHaveCount(0);

    const names: string[] = [];
    for (const folder of [MARBLY, MARBLY_ANDROID, MARBLY_WEB]) {
      await expect(add).not.toHaveAttribute('aria-busy', 'true');
      await tauri.setResponse('abs_claude_pick_folder', folder);
      await add.click();
      names.push(folder.name);
      await expect(chips).toHaveText(names);
    }

    // At three the button stays live, and a click explains the cap instead of
    // opening the dialog.
    await expect(add).not.toHaveAttribute('aria-busy', 'true');
    await expect(add).toBeEnabled();
    const picks = (await tauri.callsTo('abs_claude_pick_folder')).length;
    await add.click();
    await expect(noticeLine(panel, cap)).toBeVisible();
    expect(await tauri.callsTo('abs_claude_pick_folder')).toHaveLength(picks);

    // Taking one off makes room, and the notice goes with it.
    await panel.getByRole('button', { name: `Remove the ${MARBLY_WEB.name} folder` }).click();
    await expect(chips).toHaveText([MARBLY.name, MARBLY_ANDROID.name]);
    await expect(noticeLine(panel, cap)).toHaveCount(0);
    expect(await tauri.callsTo('abs_claude_start')).toHaveLength(0);
    expect(await tauri.unhandled()).toEqual([]);
  });

  test('a detached Agent window adds and removes folders through the editor, which opens the dialog over it', async ({
    app,
    page,
    tauri,
    isDesktop,
  }) => {
    test.skip(!isDesktop, 'code folders need the desktop app');

    await app.startBlankProject();
    await app.chooseFromMenu(page.getByTitle('Panel and display options'), 'Chat with Claude Code');
    await expect(app.activeDockPanel.getByText('Talk to the agent')).toBeVisible();
    await app.chooseFromMenu(page.getByTitle('Panel and display options'), /^agent$/i);
    const created = await tauri.waitForCall('plugin:webview|create_webview_window', 30_000);
    const url = String((created.args as { options?: { url?: string } }).options?.url ?? '');
    expect(url).toContain('panel=agent');

    // A browser cannot open the OS window, so a second page loads the URL the
    // editor asked for. The mocked event bus reaches every page of the
    // context, as Tauri's reaches every window.
    const agentWindow = await page.context().newPage();
    await agentWindow.goto(new URL(url, page.url()).href, { waitUntil: 'domcontentloaded' });
    const detached = agentWindow.locator('[data-agent-panel]');
    await expect(detached.getByText('Talk to the agent')).toBeVisible({ timeout: 30_000 });

    // A panel window may open no dialog, so the editor opens it, over the
    // Agent window rather than over itself.
    await detached.getByRole('button', { name: ADD_FOLDER }).click();
    await expect(folderChips(detached)).toHaveText([MARBLY.name]);
    expect((await tauri.callsTo('abs_claude_pick_folder')).map((call) => call.args)).toEqual([{ near: 'agent' }]);

    await detached.getByRole('button', { name: `Remove the ${MARBLY.name} folder` }).click();
    await expect(folderChips(detached)).toHaveCount(0);
    await expect
      .poll(async () => (await tauri.callsTo('abs_claude_forget_folder')).map((call) => call.args.path))
      .toEqual([MARBLY.path]);

    expect(await tauri.unhandled()).toEqual([]);
    expect(await new TauriHarness(agentWindow, true).unhandled()).toEqual([]);
  });

  test('the start screen holds its folders until Start, and a folder alone is enough to start', async ({
    app,
    page,
    tauri,
    isDesktop,
  }) => {
    test.skip(!isDesktop, 'code folders need the desktop app');

    const dialog = await openAgentScreen(page, app.startDialog);
    await expect(dialog.getByText('Claude Code 2.1.202 is ready')).toBeVisible();
    const start = dialog.getByRole('button', { name: 'Start with Claude Code' });
    // No words, no screenshots and no folder: nothing to go on.
    await expect(start).toBeDisabled();

    const row = folderRow(dialog);
    const add = row.getByRole('button', { name: ADD_FOLDER });
    const chips = folderChips(row);
    await expect(add).not.toContainText('Desktop app');

    // A refusal shows under the row, and starts nothing.
    const refusal = 'That folder holds system or private files, so the agent cannot read it';
    await tauri.setError('abs_claude_pick_folder', refusal);
    await add.click();
    await expect(noticeLine(row, refusal)).toBeVisible();
    await expect(start).toBeDisabled();
    await clearError(page, 'abs_claude_pick_folder');

    await add.click();
    await expect(chips).toHaveText([MARBLY.name]);
    await expect(noticeLine(row, refusal)).toHaveCount(0);
    await expect(row.getByRole('status')).toHaveText(`Added ${MARBLY.name}`);
    expect((await tauri.callsTo('abs_claude_pick_folder')).map((call) => call.args)).toEqual([{}, {}]);
    await expect(start).toBeEnabled();
    expect(await tauri.callsTo('abs_claude_start')).toHaveLength(0);

    // Another mode keeps the folder, and says only Claude Code reads it.
    const onlyClaudeCode = row.getByText('Only the Claude Code tab reads this folder');
    await dialog.getByRole('tab', { name: 'Use my API key' }).click();
    await expect(onlyClaudeCode).toBeVisible();
    await expect(chips).toHaveText([MARBLY.name]);
    await dialog.getByRole('tab', { name: 'Claude Code' }).click();
    await expect(onlyClaudeCode).toHaveCount(0);

    await start.click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    const args = (await tauri.waitForCall('abs_claude_start')).args.args as StartArgs;
    expect(START_KEYS).toEqual(expect.arrayContaining(Object.keys(args)));
    expect(args.folders).toEqual([MARBLY.path]);

    // The brief sends the agent to the folder, and the words say what the user gave.
    await expect.poll(async () => (await sentLines(tauri)).length).toBe(1);
    const text = (await sentLines(tauri))[0].message.content[0].text as string;
    expect(text).toContain("No screenshots were uploaded, but the user's app folder is attached.");
    expect(text).toContain(`The user also attached their app folder (${MARBLY.name}).`);
    expect(text.endsWith('Design store screenshots for my app from its code folder')).toBe(true);
    expect(text).not.toContain('<editor-context>');

    // The chat in the dock has the folder the screen picked.
    const panel = app.activeDockPanel;
    await expect(panel.getByText('Design store screenshots for my app from its code folder')).toBeVisible();
    await expect(folderChips(panel)).toHaveText([MARBLY.name]);
    expect(await tauri.unhandled()).toEqual([]);
  });

  test('only the agent imports a picture from its folder, and it sends no web links while it reads one', async ({
    app,
    page,
    tauri,
    isDesktop,
  }) => {
    test.skip(!isDesktop, 'code folders need the desktop app');

    // A run started with the folder, so the agent's process can read it.
    const dialog = await openAgentScreen(page, app.startDialog);
    const row = folderRow(dialog);
    await row.getByRole('button', { name: ADD_FOLDER }).click();
    await expect(folderChips(row)).toHaveText([MARBLY.name]);
    await dialog.getByRole('button', { name: 'Start with Claude Code' }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await tauri.waitForCall('abs_claude_start');
    await waitForListener(tauri, MCP_REQUEST_EVENT);

    // Any client can list the tool, but only a request with the agent's token
    // gets a picture out of the folder.
    const icon = `${MARBLY.path}/ios/Marbly/Assets.xcassets/AppIcon.appiconset/icon-1024.png`;
    const other = await mcpCall(tauri, 'import_project_image', { path: icon }, false);
    expect(other).toEqual({
      isError: true,
      text: "import_project_image works only for the app's built-in Claude Code agent, in a chat with a code folder attached",
    });
    expect(await tauri.callsTo('abs_claude_read_project_image')).toHaveLength(0);

    const imported = await mcpCall(tauri, 'import_project_image', { path: icon }, true);
    // The page asks Rust for the bytes by the path the agent gave; Rust
    // checks it against the folders the process was started with.
    expect((await tauri.callsTo('abs_claude_read_project_image')).map((call) => call.args)).toEqual([{ path: icon }]);
    // Where the asset store can keep a Blob, the whole import is checked; in
    // Playwright's WebKit only the bytes arriving and the store's refusal are.
    const blobs = await canStoreBlobsInIndexedDb(page);
    const expectImported = (result: { isError: boolean; text: string }, image: Record<string, unknown>) => {
      if (blobs) {
        expect(result.isError, result.text).toBe(false);
        expect(JSON.parse(result.text)).toEqual({ ref: expect.stringMatching(/^asset:/), ...image });
      } else {
        expect(result.isError).toBe(true);
        expect(result.text).toContain('Error preparing Blob/File data');
      }
    };
    expectImported(imported, { name: 'icon-1024.png', width: 1, height: 1 });

    // An SVG is stored as one and sized from its own width and height.
    const logo = await mcpCall(tauri, 'import_project_image', { path: `${MARBLY.path}/assets/logo.svg`, name: 'Logo' }, true);
    expectImported(logo, { name: 'Logo', width: 96, height: 96 });

    // A file named .svg that holds no SVG is refused before anything is stored.
    await tauri.setResponse('abs_claude_read_project_image', Array.from(new TextEncoder().encode('<html></html>')));
    const notSvg = await mcpCall(tauri, 'import_project_image', { path: `${MARBLY.path}/assets/page.svg` }, true);
    expect(notSvg).toEqual({ isError: true, text: 'That SVG file could not be read' });
    await clearResponse(page, 'abs_claude_read_project_image');

    // Rust's refusal reaches the agent as Rust wrote it.
    const outside = await mcpCall(tauri, 'import_project_image', { path: '/Users/e2e/secret.png' }, true);
    expect(outside).toEqual({ isError: true, text: 'That file is not in a code folder attached to this chat' });

    // A colour can smuggle a web address into CSS, written out or escaped, so
    // the agent's call is refused before it runs. So is a picture source the
    // browser would load from another host, a tab inside its scheme or not.
    for (const color1 of ['red), url("https://x.example/?d=Marbly"), linear-gradient(red', 'red), u\\rl(https://x.example/?d=Marbly), linear-gradient(red']) {
      const smuggled = await mcpCall(tauri, 'set_background', { gradient: { color1, color2: 'blue', angle: 90 } }, true);
      expect(smuggled, color1).toEqual({ isError: true, text: WEB_LINKS_OFF });
    }
    for (const imageSrc of ['https://x.example/?d=Marbly', 'h\ttps://x.example/?d=Marbly', '/\\x.example/?d=Marbly']) {
      const picture = await mcpCall(tauri, 'update_element', { elementId: 'el_none', imageSrc }, true);
      expect(picture, JSON.stringify(imageSrc)).toEqual({ isError: true, text: WEB_LINKS_OFF });
    }
    const plain = await mcpCall(tauri, 'set_background', { backgroundColor: '#7C5CFF' }, true);
    expect(plain.isError, plain.text).toBe(false);

    // An export cannot land in the folder the agent reads, where it could
    // overwrite the app's own icons. Rust refuses, and the agent reads why.
    const intoFolder = await mcpCall(
      tauri,
      'export_png',
      { save: true, directory: `${MARBLY.path}/ios/Marbly/Assets.xcassets/AppIcon.appiconset`, fileName: 'icon-1024', scale: 0.1 },
      true
    );
    expect(intoFolder).toEqual({
      isError: true,
      text: 'Exports cannot be saved inside the code folder the agent is reading. Leave directory out to use the default folder',
    });
    expect((await tauri.files()).filter((file) => file.via === 'abs_mcp_write_png')).toEqual([]);
    expect(await tauri.unhandled()).toEqual([]);
  });

  test("Rust's word that a process reads a folder keeps the agent's calls off the web, with nothing on the page to say so", async ({
    app,
    tauri,
    isDesktop,
  }) => {
    test.skip(!isDesktop, 'code folders need the desktop app');

    // No chat here has read a folder, so the page alone would let a web
    // link through. update_element then fails on its own, on the element.
    await app.startBlankProject();
    await waitForListener(tauri, MCP_REQUEST_EVENT);
    const leak = { elementId: 'el_none', imageSrc: 'https://x.example/?d=Marbly' };
    expect((await mcpCall(tauri, 'update_element', leak, true, false)).text).not.toBe(WEB_LINKS_OFF);
    expect((await mcpCall(tauri, 'update_element', leak, true)).text).not.toBe(WEB_LINKS_OFF);

    // Rust says a process of the agent can read one: the page lost track of
    // it, after a reload before adoption or in a chat left while its process
    // was being killed.
    expect(await mcpCall(tauri, 'update_element', leak, true, true)).toEqual({ isError: true, text: WEB_LINKS_OFF });

    // The check is for the agent only, whatever the request says.
    expect((await mcpCall(tauri, 'update_element', leak, false, true)).text).not.toBe(WEB_LINKS_OFF);
    expect(await tauri.unhandled()).toEqual([]);
  });

  test('after a reload the chat takes its running process back, and its folder with it', async ({
    app,
    page,
    tauri,
    isDesktop,
  }) => {
    test.skip(!isDesktop, 'code folders need the desktop app');

    await app.startBlankProject();
    await app.chooseFromMenu(page.getByTitle('Panel and display options'), 'Chat with Claude Code');
    const agentTab = page.getByRole('tab', { name: 'Agent', exact: true });
    await expect(app.activeDockPanel.getByText('Talk to the agent')).toBeVisible();
    await app.activeDockPanel.getByRole('button', { name: ADD_FOLDER }).click();
    await expect(folderChips(app.activeDockPanel)).toHaveText([MARBLY.name]);
    await app.activeDockPanel.getByRole('button', { name: 'Send' }).click();
    const start = (await tauri.waitForCall('abs_claude_start')).args.args as StartArgs;
    expect(start.folders).toEqual([MARBLY.path]);
    await expect.poll(async () => (await sentLines(tauri)).length).toBe(1);
    await play(tauri, start.spawnId, [
      init('i1'),
      {
        type: 'assistant',
        uuid: 'a1',
        message: { id: 'm1', content: [{ type: 'text', text: 'Read it. More in [the listing](https://x.example/?d=Marbly).' }] },
      },
      turnEnd('r1'),
    ]);
    const address = 'https://x.example/?d=Marbly';
    await expect(app.activeDockPanel.getByText(address, { exact: true })).toBeVisible();

    // Rust keeps its processes through a reload of the editor, and so does the mock.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await app.waitForBoot();
    await tauri.waitForCall('abs_claude_list', 30_000);
    await agentTab.click();
    await expect(agentTab).toHaveAttribute('aria-selected', 'true');
    const panel = app.activeDockPanel;
    await expect(folderChips(panel)).toHaveText([MARBLY.name]);
    await expect(panel.getByText(address, { exact: true })).toBeVisible();
    await expect(panel.getByRole('link', { name: 'the listing' })).toHaveCount(0);

    // The agent's calls still stay off the web.
    await waitForListener(tauri, MCP_REQUEST_EVENT);
    const leak = await mcpCall(tauri, 'update_element', { elementId: 'el_none', imageSrc: address }, true);
    expect(leak).toEqual({ isError: true, text: WEB_LINKS_OFF });

    // Taking the folder off between turns stops the process the page took
    // back, which it can only do once it knows that process again.
    await panel.getByRole('button', { name: `Remove the ${MARBLY.name} folder` }).click();
    await expect(folderChips(panel)).toHaveCount(0);
    await expect.poll(async () => (await tauri.callsTo('abs_claude_stop')).map((call) => call.args.spawnId)).toEqual([start.spawnId]);
    expect(await tauri.callsTo('abs_claude_start')).toHaveLength(0);
    expect(await tauri.unhandled()).toEqual([]);
  });

  test.describe('in the Mac App Store build', () => {
    test.use({ tauriConfig: { responses: { abs_claude_detect: { found: false, unavailable: 'sandboxed' } } } });

    test('the start screen offers no code folder, since Claude Code cannot run there', async ({
      app,
      page,
      tauri,
      isDesktop,
    }) => {
      test.skip(!isDesktop, 'the Mac App Store build is a desktop build');

      const dialog = await openAgentScreen(page, app.startDialog);
      await tauri.waitForCall('abs_claude_detect');
      await expect(dialog.getByText('Not available in this version')).toBeVisible();
      await expect(folderRow(dialog)).toHaveCount(0);
      await expect(dialog.getByRole('button', { name: ADD_FOLDER })).toHaveCount(0);
      expect(await tauri.unhandled()).toEqual([]);
    });
  });

  test('on the web the button explains that code folders need the desktop app', async ({ app, page, isDesktop }) => {
    test.skip(isDesktop, 'the desktop app opens the folder dialog instead');

    const dialog = await openAgentScreen(page, app.startDialog);
    const row = folderRow(dialog);
    const toggle = row.getByRole('button', { name: ADD_FOLDER });
    await expect(toggle).toContainText('Desktop app');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // The Claude Code tab has a desktop app alert of its own, so this one is
    // found inside the row, by its title.
    const alert = row.getByRole('alert').filter({ hasText: 'Code folders need the desktop app' });
    await expect(alert).toHaveCount(0);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(alert).toBeVisible();
    await expect(alert).toHaveAttribute('id', (await toggle.getAttribute('aria-controls')) ?? '');
    await expect(alert).toContainText('Claude Code reads the folder on your computer');
    await expect(dialog.getByRole('button', { name: 'Get the desktop app' })).toHaveCount(2);

    const opened = await recordWindowOpen(page);
    await alert.getByRole('button', { name: 'Get the desktop app' }).click();
    await expect.poll(opened, { timeout: 15_000 }).toEqual([DESKTOP_DOWNLOAD_URL]);

    // A second click puts it away, and nothing was picked.
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(alert).toHaveCount(0);
    await expect(folderChips(row)).toHaveCount(0);
    expect(await page.evaluate(() => '__TAURI_INTERNALS__' in window)).toBe(false);
  });
});
