// A reload with a Codex chat's process still running. Rust keeps the process,
// and the store takes it back from Rust's list, mid-turn as it was, while any
// process of either CLI that no page will talk to again is stopped. In a file
// of its own, because the store reads the save once, on its first call.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CODEX_THREAD, answers, callsTo, codexTurns, notify, settle, storage } from './helpers/claudeDesktop';
import { claudeAgent } from '@/lib/claudeCode/store';
import { toAgentPanelView } from '@/lib/claudeCode/view';

const OLD = 'cx-old-process';
const snap = () => claudeAgent.getSnapshot();

storage.set(
  'osg-claude-agent-v1',
  JSON.stringify({
    v: 1,
    sessionId: CODEX_THREAD,
    resolvedModel: 'gpt-6.1-sol',
    spawnId: OLD,
    processAgent: 'codex',
    processModel: null,
    processEffort: null,
    processFolders: [],
    items: [{ kind: 'user', id: 'u1', text: 'Make it dark', attachments: 0, at: 1 }],
    chat: { id: 'chat-cx', agent: 'codex', projectId: 'p1', projectName: 'P1', createdAt: 1, folders: [] },
  })
);
answers.abs_codex_list = () => [
  { spawnId: OLD, busy: true, threadId: CODEX_THREAD },
  { spawnId: 'cx-stray', busy: false, threadId: null },
];
answers.abs_claude_list = () => [{ spawnId: 'cc-stray', busy: false, folders: [] }];

test('a reload takes back a busy Codex process and stops the strays of both CLIs', async () => {
  claudeAgent.subscribe(() => {});
  await settle();
  await settle();
  assert.equal(snap().chat.agent, 'codex');
  assert.equal(snap().session.status, 'working', 'Rust says the turn is still on');
  assert.equal(snap().session.sessionId, CODEX_THREAD);
  assert.deepEqual(callsTo('abs_codex_stop').map((entry) => entry.args.spawnId), ['cx-stray']);
  assert.deepEqual(callsTo('abs_claude_stop').map((entry) => entry.args.spawnId), ['cc-stray']);
  assert.equal(claudeAgent.agentReadsFolders(), false);
  assert.equal(toAgentPanelView(snap(), null).agentSwitchable, false);

  // The adopted process is the one Stop reaches.
  await claudeAgent.stop();
  assert.deepEqual(callsTo('abs_codex_interrupt').map((entry) => entry.args.spawnId), [OLD]);
  notify('turn/completed', { threadId: CODEX_THREAD, turn: { id: 'turn-1', status: 'interrupted', items: [] } }, OLD);
  assert.equal(snap().session.status, 'ready');

  // And the next message goes to it, with no new start.
  await claudeAgent.send({ text: 'Now lighter' });
  assert.equal(callsTo('abs_codex_start').length, 0);
  assert.equal(callsTo('abs_codex_send').at(-1)!.args.spawnId, OLD);
  assert.equal(codexTurns().at(-1)!.text, 'Now lighter');
});
