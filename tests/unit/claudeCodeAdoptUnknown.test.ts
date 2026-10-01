// A reload after an update from a build that kept no folders anywhere: the
// save names none, and neither does Rust's list. The process may read
// whatever it was started with, so it counts as reading until the next
// message replaces it. In a file of its own, because the store reads the save
// once, on its first call.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SESSION, answers, callsTo, endTurn, lastStart, sentTexts, settle, storage } from './helpers/claudeDesktop';
import { claudeAgent } from '@/lib/claudeCode/store';
import { toAgentPanelView } from '@/lib/claudeCode/view';

const OLD = 'cc-old-process';
const snap = () => claudeAgent.getSnapshot();

storage.set(
  'osg-claude-agent-v1',
  JSON.stringify({
    v: 1,
    sessionId: SESSION,
    resolvedModel: 'claude-haiku-4-5-20251001',
    spawnId: OLD,
    items: [{ kind: 'user', id: 'u1', text: 'Hello', attachments: 0, at: 1 }],
    chat: { id: 'chat-old', projectId: 'p1', projectName: 'P1', createdAt: 1 },
  })
);
answers.abs_claude_list = () => [{ spawnId: OLD, busy: false }];

test('a process whose folders nobody kept counts as reading them', async () => {
  claudeAgent.subscribe(() => {});
  await settle();
  assert.equal(snap().session.status, 'ready');
  assert.equal(claudeAgent.agentReadsFolders(), true);
  assert.equal(snap().foldersLive, true);
  assert.equal(claudeAgent.agentMayHoldFolderData(), true);
  assert.equal(toAgentPanelView(snap(), null).linksAsText, true);
  assert.equal(snap().chat.readFolders, true, 'the chat keeps that for good');

  // Nothing says what it can read, so the next message replaces it with one
  // started on the chat's folders, here none, and the same conversation. The
  // save does not say its effort either, and the new one gets the chosen level.
  await claudeAgent.send({ text: 'Carry on' });
  assert.deepEqual(callsTo('abs_claude_stop').map((entry) => entry.args.spawnId), [OLD]);
  assert.equal(lastStart().resume, SESSION);
  assert.equal(lastStart().effort, 'max');
  assert.equal('folders' in lastStart(), false);
  assert.equal(sentTexts().at(-1), 'Carry on');
  assert.equal(claudeAgent.agentReadsFolders(), false);
  assert.equal(claudeAgent.agentMayHoldFolderData(), true, 'the conversation may still hold what it read');
  endTurn('r1');
});
