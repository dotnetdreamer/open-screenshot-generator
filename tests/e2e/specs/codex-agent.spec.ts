import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '../fixtures/test';
import { TauriHarness } from '../fixtures/tauri';

/**
 * The Codex mode of the AI agent, and a Codex chat in the Agent panel.
 *
 * Nothing here starts a real Codex. On the desktop project the IPC is the mock
 * in fixtures/tauri-runtime.ts, so a spec answers `abs_codex_detect`, reads the
 * turns the app sends with `abs_codex_send`, and plays Codex's notifications
 * back through the event codex.rs emits. claude-agent.spec.ts covers what the
 * two agents share (Past chats, the ring, the detached window) for Claude Code.
 */

/** Must match EVENT in src-tauri/src/codex.rs. */
const CODEX_EVENT = 'abs-codex-event';
/** What the IPC mock answers for abs_mcp_bridge_nonce. */
const NONCE = 'e2e-bridge-nonce';
/** The thread the mock's abs_codex_start opens. */
const THREAD = '01a13963-abeb-7f92-b6ea-64f6cb531353';
/** Everything the page may put in abs_codex_start. The brief is built into the app. */
const START_KEYS = ['spawnId', 'model', 'resume', 'pageEpoch'];
const ADD_FOLDER = "Add your app's code folder";

const CODEX_READY = {
  found: true,
  path: '/opt/homebrew/bin/codex',
  version: 'codex-cli 0.162.0',
  loggedIn: true,
  authMethod: 'chatgpt',
  planType: 'plus',
  models: [
    { id: 'gpt-6.1-sol', displayName: 'GPT-6.1-Sol', efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'low', isDefault: true },
    { id: 'gpt-6-luna', displayName: 'GPT-6-Luna', efforts: ['low', 'medium'], defaultEffort: 'medium', isDefault: false },
  ],
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
    .poll(async () => (await tauri.callsTo('plugin:event|listen')).some((call) => call.args.event === event), {
      timeout: 30_000,
      message: `the app never subscribed to ${event}`,
    })
    .toBe(true);
}

/** What each Codex turn went out with. */
async function turns(tauri: TauriHarness): Promise<Array<{ text: string; images: unknown[]; model?: string; effort?: string }>> {
  return (await tauri.callsTo('abs_codex_send')).map((call) => call.args.turn as never);
}

async function notify(tauri: TauriHarness, spawnId: string, method: string, params: Record<string, unknown>) {
  await tauri.emitFromBackend(CODEX_EVENT, { spawnId, kind: 'notification', method, params, nonce: NONCE });
}

/** The notifications of a real Codex turn the unit tests replay too, moved onto the mock's thread. */
function recordedTurn(): Array<{ method: string; params: Record<string, unknown> }> {
  const lines = readFileSync(path.join(process.cwd(), 'tests', 'unit', 'fixtures', 'codex', 'tool-turn.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const recorded: string = lines.find((line) => 'start' in line).start.threadId;
  return lines
    .filter((line) => 'method' in line)
    .map((line) => JSON.parse(JSON.stringify(line).replaceAll(recorded, THREAD)));
}

test.describe('the Codex tab', () => {
  test('comes second, after Claude Code, on both builds', async ({ app, page, isDesktop, tauri }) => {
    const dialog = await openAgentScreen(page, app.startDialog);
    await expect(dialog.getByRole('tab').first()).toHaveText('Claude Code');
    const tab = dialog.getByRole('tab', { name: 'Codex', exact: true });
    await expect(dialog.getByRole('tab').nth(1)).toHaveText('Codex');
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');

    if (isDesktop) {
      // The mock reports no Codex, so the tab explains how to get it.
      await tauri.waitForCall('abs_codex_detect');
      await expect(dialog.getByText('Codex is not installed')).toBeVisible();
      await expect(dialog.getByText('npm install -g @openai/codex')).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Start with Codex' })).toBeDisabled();
      expect(await tauri.unhandled()).toEqual([]);
    } else {
      await expect(dialog.getByText('Codex runs in the desktop app')).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Start with Codex' })).toHaveCount(0);
    }
  });
});

test.describe('a Codex run', () => {
  test.use({ tauriConfig: { responses: { abs_codex_detect: CODEX_READY } } });

  test('makes a project, opens a Codex chat in the Agent panel and keeps it going', async ({ app, page, tauri, isDesktop }) => {
    test.skip(!isDesktop, 'Codex runs in the desktop app');

    const dialog = await openAgentScreen(page, app.startDialog);
    await dialog.getByRole('tab', { name: 'Codex', exact: true }).click();
    await expect(dialog.getByText('Codex 0.162.0 is ready')).toBeVisible();
    await expect(dialog.getByText('Uses your ChatGPT Plus plan')).toBeVisible();
    await expect(dialog.locator('#codex-model')).toHaveText("Codex's default model");
    await expect(dialog.locator('#codex-effort')).toHaveText('Max');
    await page.locator('#agent-instruction').fill('Dark set for a habit tracker called Droply');
    await dialog.getByRole('button', { name: 'Start with Codex' }).click();

    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expect(app.artboards).toHaveCount(1);
    const agentTab = page.getByRole('tab', { name: 'Agent', exact: true });
    await expect(agentTab).toHaveAttribute('aria-selected', 'true');
    const panel = app.activeDockPanel;
    await expect(panel.getByText('Codex', { exact: true }).first()).toBeVisible();

    // The listener goes up before the process, and Claude Code never starts.
    await waitForListener(tauri, CODEX_EVENT);
    const start = await tauri.waitForCall('abs_codex_start');
    const args = start.args.args as Record<string, unknown>;
    expect(START_KEYS).toEqual(expect.arrayContaining(Object.keys(args)));
    expect(args.resume).toBeUndefined();
    expect(args.model).toBeUndefined();
    expect(args.pageEpoch).toBe(1);
    expect(await tauri.callsTo('abs_claude_start')).toHaveLength(0);
    const spawnId = args.spawnId as string;
    expect(spawnId).toMatch(/^cx-/);

    // The first turn: the brief naming the new project, then the words, at Max.
    await expect.poll(async () => (await turns(tauri)).length).toBe(1);
    const [first] = await turns(tauri);
    expect(first.text).toContain('"Droply screenshots"');
    expect(first.text).toContain('Dark set for a habit tracker called Droply');
    expect(first.text).not.toContain('<editor-context>');
    expect(first.effort).toBe('max');
    expect(first.model).toBeUndefined();
    await expect(panel.getByText('Working...').first()).toBeVisible();

    // Codex answers with a recorded turn: design calls, a picture, a streamed reply.
    for (const line of recordedTurn()) await notify(tauri, spawnId, line.method, line.params);
    await expect(panel.getByText('I changed the headline on Screen 1 to Track every drop.')).toBeVisible();
    await expect(panel.getByText('Looked at the artboards')).toBeVisible();
    await expect(panel.getByText('Edited an element')).toBeVisible();
    await expect(panel.getByText('GPT-6.1-Sol, max effort')).toBeVisible();
    // Codex reads no code folder, so the panel offers none.
    await expect(panel.getByRole('button', { name: ADD_FOLDER })).toHaveCount(0);

    // A follow-up goes to the same process, with the context and the model picked since.
    await panel.getByRole('button', { name: 'Agent options' }).click();
    await page.getByRole('menuitemradio', { name: 'GPT-6-Luna' }).click();
    await page.keyboard.press('Escape');
    await panel.getByLabel('Message the agent').fill('Make the headline bigger');
    await panel.getByRole('button', { name: 'Send' }).click();
    await expect.poll(async () => (await turns(tauri)).length).toBe(2);
    const second = (await turns(tauri))[1];
    expect(second.text).toMatch(/^<editor-context>/);
    expect(second.text.endsWith('Make the headline bigger')).toBe(true);
    expect(second.model).toBe('gpt-6-luna');
    // Luna goes no higher than medium.
    expect(second.effort).toBe('medium');
    expect(await tauri.callsTo('abs_codex_start')).toHaveLength(1);

    // Stop interrupts the turn and keeps the process.
    await notify(tauri, spawnId, 'turn/started', { threadId: THREAD, turn: { id: 'turn-2', status: 'inProgress', items: [] } });
    await panel.getByRole('button', { name: 'Stop' }).click();
    await tauri.waitForCall('abs_codex_interrupt');
    await notify(tauri, spawnId, 'turn/completed', { threadId: THREAD, turn: { id: 'turn-2', status: 'interrupted', items: [] } });
    await expect(panel.getByText('Stopped', { exact: true })).toBeVisible();
    expect(await tauri.callsTo('abs_codex_stop')).toHaveLength(0);

    // A new chat ends the process and keeps the agent.
    await panel.getByRole('button', { name: 'Start a new chat' }).click();
    await tauri.waitForCall('abs_codex_stop');
    await expect(panel.getByText('Talk to the agent')).toBeVisible();
    await expect(panel.getByRole('radio', { name: 'Codex' })).toHaveAttribute('aria-checked', 'true');

    expect(await tauri.unhandled()).toEqual([]);
  });
});

test.describe('the Agent panel', () => {
  test('an empty chat switches between Claude Code and Codex', async ({ app, page, tauri, isDesktop }) => {
    test.skip(!isDesktop, 'the agent runs in the desktop app');
    await app.startBlankProject();
    await app.chooseFromMenu(page.getByTitle('Panel and display options'), 'Chat with Codex');
    const panel = app.activeDockPanel;
    const picker = panel.getByRole('radiogroup', { name: 'Agent' });
    await expect(picker.getByRole('radio', { name: 'Codex' })).toHaveAttribute('aria-checked', 'true');
    // The mock has no Codex, so the chat says how to get it.
    await tauri.waitForCall('abs_codex_detect');
    await expect(panel.getByText('Codex is not installed')).toBeVisible();
    await expect(panel.getByRole('button', { name: ADD_FOLDER })).toHaveCount(0);

    await picker.getByRole('radio', { name: 'Claude Code' }).click();
    await expect(picker.getByRole('radio', { name: 'Claude Code' })).toHaveAttribute('aria-checked', 'true');
    await expect(panel.getByText('Claude Code is not installed')).toBeVisible();
    await expect(panel.getByRole('button', { name: ADD_FOLDER })).toBeVisible();

    await picker.getByRole('radio', { name: 'Codex' }).click();
    await expect(panel.getByRole('button', { name: ADD_FOLDER })).toHaveCount(0);
    expect(await tauri.callsTo('abs_codex_start')).toHaveLength(0);
    expect(await tauri.unhandled()).toEqual([]);
  });
});
