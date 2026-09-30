import { test, expect, type Page } from '../fixtures/test';
import type { TauriHarness } from '../fixtures/tauri';

/**
 * The Claude Code mode of the AI agent, and the Agent panel it opens.
 *
 * Nothing here starts a real Claude Code. On the desktop project the IPC is the
 * mock in fixtures/tauri-runtime.ts, so a spec plays the process's side itself:
 * it answers `abs_claude_detect`, reads the lines the app writes with
 * `abs_claude_send`, and replays stream-json output through the same event the
 * Rust side emits. What is under test is everything the app does with that:
 * the tab, the project it makes, the panel, and what goes to stdin.
 */

/** Must match EVENT in src-tauri/src/claude_code.rs. */
const CLAUDE_EVENT = 'abs-claude-event';
/** What the IPC mock answers for abs_mcp_bridge_nonce; Rust stamps every event with it. */
const NONCE = 'e2e-bridge-nonce';

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
  session_id: '6e6cdc77-0d28-43a0-955d-9cad1fb02032',
  model: 'claude-opus-5-5',
  mcp_servers: [{ name: 'osg-editor', status: 'connected' }],
  apiKeySource: 'none',
  uuid,
});

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
    // The page picks the process, the model and the conversation, and says
    // which page load it is, nothing else: the system prompt and the skills
    // are built into the app.
    const args = start.args.args as { spawnId: string; resume?: string; pageEpoch?: number };
    expect(['spawnId', 'model', 'resume', 'pageEpoch']).toEqual(expect.arrayContaining(Object.keys(args)));
    expect(args.resume).toBeUndefined();
    expect(args.pageEpoch).toBe(1);
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
      { type: 'assistant', uuid: 'a1', message: { id: 'm1', content: [{ type: 'text', text: 'Starting with a **dark** template.' }] } },
      {
        type: 'assistant',
        uuid: 'a2',
        message: { id: 'm1', content: [{ type: 'tool_use', id: 'tu1', name: 'mcp__osg-editor__list_artboards', input: {} }] },
      },
      { type: 'user', uuid: 'u1', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: [{ type: 'text', text: '[]' }] }] } },
      { type: 'result', subtype: 'success', is_error: false, result: 'done', num_turns: 2, duration_ms: 1200, session_id: '6e6cdc77-0d28-43a0-955d-9cad1fb02032', uuid: 'r1' },
    ]);
    await expect(panel.getByText('dark', { exact: true })).toBeVisible();
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
    const session = '6e6cdc77-0d28-43a0-955d-9cad1fb02032';
    const turnEnd = (uuid: string) => ({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'done',
      num_turns: 1,
      duration_ms: 500,
      session_id: session,
      uuid,
    });

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
    const second = (await tauri.callsTo('abs_claude_start'))[1].args.args as { spawnId: string; resume?: string };
    expect(second.resume).toBe(session);
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
