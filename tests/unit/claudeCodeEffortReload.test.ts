// After a reload: the saved effort comes back, and a process the page adopts
// that was started at another effort is replaced on the next message, with
// the conversation resumed. Its own file, because the store reads storage
// once, when it first runs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SESSION, answers, callsTo, endTurn, lastStart, settle, storage } from './helpers/claudeDesktop';
import { claudeAgent } from '@/lib/claudeCode/store';

const OLD = 'cc-old-process';
const snap = () => claudeAgent.getSnapshot();

// The user picked Medium, but the process still running was started at Max,
// before the pick and the reload.
storage.set('osg-claude-agent-effort', 'medium');
storage.set(
  'osg-claude-agent-v1',
  JSON.stringify({
    v: 1,
    sessionId: SESSION,
    resolvedModel: 'claude-opus-5-5',
    spawnId: OLD,
    processModel: 'default',
    processEffort: 'max',
    processFolders: [],
    items: [{ kind: 'user', id: 'u1', text: 'Make it dark', attachments: 0, at: 1 }],
    chat: { id: 'chat-old', projectId: 'p1', projectName: 'P1', createdAt: 1, folders: [], readFolders: false, ranFolders: [] },
  })
);
answers.abs_claude_list = () => [{ spawnId: OLD, busy: false, folders: [] }];

test('the saved effort comes back, and an adopted process at another one is replaced', async () => {
  claudeAgent.subscribe(() => {});
  await settle();
  assert.equal(snap().effort, 'medium');
  assert.equal(snap().session.status, 'ready', 'the running process was adopted');

  await claudeAgent.send({ text: 'Bigger headline' });
  assert.deepEqual(callsTo('abs_claude_stop').map((entry) => entry.args.spawnId), [OLD]);
  assert.equal(lastStart().effort, 'medium');
  assert.equal(lastStart().resume, SESSION);
  endTurn('r1');
});
