// A reload where the page's own save about its process is out of date: it
// says the process reads no folder, while Rust's list says it reads one. Rust
// knows, so its list wins: the agent counts as reading the folder, the chat is
// marked for good, and a removal between turns ends access. In a file of its
// own, because the store reads the save once, on its first call.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SESSION, answers, callsTo, endTurn, marbly, sentTexts, settle, storage } from './helpers/claudeDesktop';
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
    processModel: 'default',
    processEffort: 'max',
    processFolders: [],
    items: [{ kind: 'user', id: 'u1', text: 'Use the folder I added', attachments: 0, at: 1 }],
    chat: { id: 'chat-old', projectId: 'p1', projectName: 'P1', createdAt: 1, folders: [marbly], readFolders: false, ranFolders: [] },
  })
);
answers.abs_claude_list = () => [{ spawnId: OLD, busy: false, folders: [marbly.path] }];

test("Rust's list of what a process reads wins over what the page saved", async () => {
  claudeAgent.subscribe(() => {});
  await settle();
  assert.equal(snap().session.status, 'ready');
  assert.equal(claudeAgent.agentReadsFolders(), true);
  assert.equal(snap().foldersLive, true);
  assert.equal(snap().chat.readFolders, true, 'the chat keeps that for good');
  assert.equal(toAgentPanelView(snap(), null).linksAsText, true);
  assert.deepEqual(snap().chat.ranFolders, [marbly.path]);
  assert.equal(snap().foldersPending, false, 'the process already reads the folder the chat holds');

  // The same folder, so the next message goes to the same process with no folder line.
  await claudeAgent.send({ text: 'Bigger icon' });
  assert.equal(callsTo('abs_claude_start').length, 0);
  assert.equal(callsTo('abs_claude_send').at(-1)!.args.spawnId, OLD);
  assert.equal(sentTexts().at(-1), 'Bigger icon');
  endTurn('r1', OLD);

  // Between turns a removal stops the process at once, and the conversation
  // still counts as holding what it read.
  assert.equal(await claudeAgent.removeFolder(marbly.path), true);
  assert.deepEqual(callsTo('abs_claude_stop').map((entry) => entry.args.spawnId), [OLD]);
  assert.equal(claudeAgent.agentReadsFolders(), false);
  assert.equal(claudeAgent.agentMayHoldFolderData(), true);
});
