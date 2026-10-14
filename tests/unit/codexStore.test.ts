// A Codex chat in the agent store, driven end to end in node: the stand-in
// answers the commands codex.rs would, and plays Codex's notifications back
// through the same event. What is checked is what reaches Rust (the start,
// each turn's text, model and effort, the interrupt) and what the chat keeps:
// its agent, its conversation, and no code folder.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  CODEX_THREAD,
  answers,
  callsTo,
  codexTurns,
  endCodexTurn,
  invokes,
  lastCodexStart,
  notify,
  playCodex,
  resetAnswers,
  rows,
  settle,
} from './helpers/claudeDesktop';
import { CODEX_NO_FOLDERS, claudeAgent } from '@/lib/claudeCode/store';
import { toAgentPanelView } from '@/lib/claudeCode/view';
import { CODEX_SIGN_IN_MESSAGE } from '@/lib/codex/reducer';

const snap = () => claudeAgent.getSnapshot();
const view = () => toAgentPanelView(snap(), null);
const noticeTexts = () => snap().session.items.filter((item) => item.kind === 'notice').map((item) => (item as { text: string }).text);

/** The relayed notifications of the recorded tool turn (tests/unit/fixtures/codex). */
function toolTurn(): { method: string; params: Record<string, unknown> }[] {
  const lines = fs
    .readFileSync(path.join(process.cwd(), 'tests', 'unit', 'fixtures', 'codex', 'tool-turn.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  // The recording opened a thread of its own; the stand-in opens CODEX_THREAD.
  const recorded: string = lines.find((line) => 'start' in line).start.threadId;
  return lines
    .filter((line) => 'method' in line)
    .map((line) => JSON.parse(JSON.stringify(line).replaceAll(recorded, CODEX_THREAD)));
}

test('a chat switched to Codex before it begins sends its turns to Codex', async () => {
  claudeAgent.subscribe(() => {});
  await claudeAgent.newChat({ projectId: 'p1', projectName: 'Droply screenshots' });
  assert.equal(snap().chat.agent, 'claude-code', 'Claude Code until the user picks');
  assert.equal(view().agentSwitchable, true);

  assert.equal(claudeAgent.setChatAgent('codex'), true);
  assert.equal(snap().chat.agent, 'codex');
  assert.equal(snap().newChatAgent, 'codex', 'the next new chat starts with Codex too');

  await claudeAgent.send({ text: 'Make the headline bigger' });
  assert.equal(callsTo('abs_claude_start').length, 0, 'Claude Code never starts');
  // Nothing had looked for Codex yet, so the first start does, for the model levels.
  const detectedAt = invokes.findIndex((entry) => entry.cmd === 'abs_codex_detect');
  const startedAt = invokes.findIndex((entry) => entry.cmd === 'abs_codex_start');
  assert.ok(detectedAt >= 0 && detectedAt < startedAt, 'detected before it started');
  assert.equal(snap().codexDetection.result?.planType, 'plus');
  const start = lastCodexStart();
  assert.match(start.spawnId, /^cx-/);
  assert.equal('resume' in start && start.resume !== undefined, false, 'a new conversation');
  assert.equal(start.pageEpoch, 1);
  assert.equal(start.model, undefined, "Codex's own default model");
  const [turn] = codexTurns();
  assert.equal(turn.text, 'Make the headline bigger');
  assert.deepEqual(turn.images, []);
  assert.equal(turn.model, undefined);
  // Max is picked, and the default model goes no higher than xhigh.
  assert.equal(turn.effort, 'xhigh');
  assert.equal(snap().session.sessionId, CODEX_THREAD);
  assert.equal(snap().session.status, 'working');
  assert.equal(view().agentSwitchable, false);

  for (const line of toolTurn()) notify(line.method, line.params);
  assert.equal(snap().session.status, 'ready');
  assert.deepEqual(
    snap().session.items.filter((item) => item.kind === 'tool').map((item) => (item as { name: string }).name),
    ['list_artboards', 'get_artboard', 'update_element', 'export_png']
  );
  assert.equal(snap().session.toolsConnected, true);
  assert.equal(snap().session.context?.window, 258400);
});

test('the next message reuses the process with the model picked since, and its levels', async () => {
  claudeAgent.setContextProvider(() => ({
    projectId: 'p1',
    projectName: 'Droply screenshots',
    artboards: [{ id: 'artboard_1', name: 'Screen 1', width: 1206, height: 2622 }],
    activeArtboardId: 'artboard_1',
    selection: [],
    activeLocale: null,
  }));
  claudeAgent.setCodexModel('gpt-6-luna');
  claudeAgent.setCodexEffort('high');
  await claudeAgent.send({ text: 'Try a darker background' });
  assert.equal(callsTo('abs_codex_start').length, 1, 'no new process for a new model');
  const turn = codexTurns().at(-1)!;
  assert.equal(turn.model, 'gpt-6-luna');
  assert.equal(turn.effort, 'medium', 'luna goes no higher than medium');
  assert.match(turn.text, /^<editor-context>/, 'the editor context comes first, as for Claude Code');
  endCodexTurn('turn-2');
  assert.equal(snap().session.status, 'ready');
  assert.equal(view().codexEffort, 'high', 'the pick itself stays');
  claudeAgent.setContextProvider(null);
});

test('a chat that has begun keeps its agent, takes no code folder and never reads one', async () => {
  assert.equal(claudeAgent.setChatAgent('claude-code'), false);
  assert.equal(snap().chat.agent, 'codex');
  assert.equal(snap().newChatAgent, 'claude-code', 'though the next new chat takes the pick');
  claudeAgent.setChatAgent('codex');

  const pick = await claudeAgent.pickFolder({ addToChat: true });
  assert.deepEqual(pick, { kind: 'refused', message: CODEX_NO_FOLDERS });
  assert.equal(callsTo('abs_claude_pick_folder').length, 0, 'the dialog never opens');
  assert.equal(snap().folderNotice, CODEX_NO_FOLDERS);
  assert.equal(claudeAgent.addFolder({ name: 'Marbly', path: '/Users/me/code/Marbly' }), false);
  assert.deepEqual(snap().chat.folders, []);
  // The process is live, and still nothing counts as reading a folder.
  assert.equal(claudeAgent.agentReadsFolders(), false);
  assert.equal(claudeAgent.agentMayHoldFolderData(), false);
  assert.equal(snap().foldersPending, false);
});

test('Stop interrupts the turn, and the turn ends as Stopped', async () => {
  await claudeAgent.send({ text: 'Add an artboard' });
  notify('turn/started', { threadId: CODEX_THREAD, turn: { id: 'turn-3', status: 'inProgress', items: [] } });
  await claudeAgent.stop();
  const interrupts = callsTo('abs_codex_interrupt');
  assert.equal(interrupts.length, 1);
  assert.equal(interrupts[0].args.spawnId, lastCodexStart().spawnId);
  notify('turn/completed', { threadId: CODEX_THREAD, turn: { id: 'turn-3', status: 'interrupted', items: [] } });
  assert.equal(snap().session.status, 'ready');
  assert.equal(noticeTexts().at(-1), 'Stopped');
  assert.equal(callsTo('abs_codex_stop').length, 0, 'the process stays up for the next message');
});

test('a refused turn and a process that dies each end the turn with a word', async () => {
  await claudeAgent.send({ text: 'One more' });
  playCodex({ kind: 'turnFailed', message: 'Not logged in. Run codex login' });
  assert.equal(snap().session.status, 'ready');
  assert.equal(noticeTexts().at(-1), CODEX_SIGN_IN_MESSAGE);

  await claudeAgent.send({ text: 'And again' });
  playCodex({ kind: 'exit', code: 1, stderrTail: ['thread main panicked: boom'] });
  assert.equal(snap().session.status, 'stopped');
  assert.equal(noticeTexts().at(-1), 'Codex stopped: thread main panicked: boom');
});

test('Past chats keeps a Codex chat, and opening it resumes its thread', async () => {
  const codexChat = snap().chat.id!;
  // The process died in the last test, so this message starts another on the same thread.
  await claudeAgent.send({ text: 'After the crash' });
  assert.equal(lastCodexStart().resume, CODEX_THREAD);
  endCodexTurn('turn-5');
  const stops = callsTo('abs_codex_stop').length;
  await claudeAgent.newChat(undefined, { agent: 'claude-code' });
  assert.equal(snap().chat.agent, 'claude-code');
  await settle();
  assert.equal(callsTo('abs_codex_stop').length, stops + 1, 'the chat left takes its process with it');
  // Saved as it was left, with its agent and its thread.
  assert.equal(rows.get(codexChat)?.agent, 'codex');
  assert.equal(rows.get(codexChat)?.sessionId, CODEX_THREAD);

  assert.equal(await claudeAgent.openChat(codexChat), true);
  assert.equal(snap().chat.agent, 'codex');
  await claudeAgent.send({ text: 'Back to this one' });
  assert.equal(lastCodexStart().resume, CODEX_THREAD);
  endCodexTurn('turn-6');
  assert.equal(snap().session.sessionId, CODEX_THREAD);
});

test('a thread Codex no longer has becomes a new one, with a word', async () => {
  const fresh = '01a13999-0000-7000-8000-000000000001';
  answers.abs_codex_start = () => ({ pid: 1, threadId: fresh, resumed: false, model: 'gpt-6-luna', mcpUrl: 'x' });
  // A new process: the old one goes with the chat being left.
  const codexChat = snap().chat.id!;
  await claudeAgent.newChat(undefined, { agent: 'codex' });
  await claudeAgent.openChat(codexChat);
  await claudeAgent.send({ text: 'Still there?' });
  resetAnswers();
  assert.equal(lastCodexStart().resume, CODEX_THREAD);
  assert.equal(snap().session.sessionId, fresh);
  assert.ok(noticeTexts().includes('The earlier conversation was gone, so this is a new one'));
  assert.equal(snap().session.context, null);
});
