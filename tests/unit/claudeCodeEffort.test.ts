// The effort level, driven through the store with the desktop stand-in: every
// start carries it, Max until the user picks another, and a new pick takes
// effect on the next message by restarting the process on the same
// conversation, the way a new model does.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SESSION, callsTo, endTurn, lastStart, operations, settle, storage } from './helpers/claudeDesktop';
import { claudeAgent } from '@/lib/claudeCode/store';
import { toAgentPanelView } from '@/lib/claudeCode/view';
import type { ClaudeEffortChoice } from '@/lib/claudeCode/types';

const snap = () => claudeAgent.getSnapshot();

test('every start carries the effort, Max until the user picks another', async () => {
  claudeAgent.subscribe(() => {});
  await claudeAgent.newChat({ projectId: 'p1', projectName: 'Marbly screenshots' });
  assert.equal(snap().effort, 'max');
  assert.equal(toAgentPanelView(snap(), null).effort, 'max');
  assert.equal(storage.get('osg-claude-agent-effort'), undefined, 'nothing saved until the user picks');

  await claudeAgent.send({ text: 'Make it dark' });
  assert.equal(lastStart().effort, 'max');
  endTurn('r1');
  await settle();

  // The run log says what the process was started with, since init does not.
  const run = [...operations.values()].find((operation) => operation.instruction === 'Make it dark');
  assert.ok(run, 'the turn was logged');
  const started = run.entries.find((entry) => entry.label === 'Claude Code started the turn');
  assert.match(started?.detail ?? '', /^effort: max$/m);
});

test('a new effort waits for the next message, then restarts the process on the same conversation', async () => {
  const before = callsTo('abs_claude_start').length;
  const running = lastStart().spawnId;

  claudeAgent.setEffort('high');
  assert.equal(snap().effort, 'high');
  assert.equal(storage.get('osg-claude-agent-effort'), 'high');
  assert.equal(callsTo('abs_claude_stop').length, 0, 'the process is left alone until there is a message for it');

  await claudeAgent.send({ text: 'Bigger headline' });
  assert.deepEqual(callsTo('abs_claude_stop').map((entry) => entry.args.spawnId), [running]);
  assert.equal(callsTo('abs_claude_start').length, before + 1);
  assert.equal(lastStart().effort, 'high');
  assert.equal(lastStart().resume, SESSION, 'the conversation carries on');
  endTurn('r2');

  // The same effort again: the same process.
  await claudeAgent.send({ text: 'Thanks' });
  assert.equal(callsTo('abs_claude_start').length, before + 1);
  endTurn('r3');
});

test('a level Claude Code does not take is refused, and the pick stays', () => {
  for (const bogus of ['ultra', 'auto', 'MAX', '', 'max --tools Bash']) {
    claudeAgent.setEffort(bogus as ClaudeEffortChoice);
    assert.equal(snap().effort, 'high', bogus);
  }
  assert.equal(storage.get('osg-claude-agent-effort'), 'high');
});
