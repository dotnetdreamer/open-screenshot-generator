// A reload with Claude Code still running. The page starts from nothing but
// what it saved, Rust keeps the process, and the store takes it back (adopt)
// from Rust's list: what it can read and whether it is mid-turn. Until Rust
// answers, the page cannot tell, so a folder is not taken off yet and the
// chat's links stay text. In a file of its own, because the store reads the
// save once, on its first call.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SESSION,
  answers,
  callsTo,
  endTurn,
  lastStart,
  marbly,
  resetAnswers,
  sentTexts,
  settle,
  storage,
  web,
} from './helpers/claudeDesktop';
import { claudeAgent } from '@/lib/claudeCode/store';
import { FOLDERS_CHANGED_NOTE } from '@/lib/claudeCode/folders';
import { toAgentPanelView } from '@/lib/claudeCode/view';

const OLD = 'cc-old-process';
const snap = () => claudeAgent.getSnapshot();

// What the editor saved before the reload: a chat with a folder whose process
// was mid-turn, saved by a build from before the chat kept readFolders and
// ranFolders.
storage.set(
  'osg-claude-agent-v1',
  JSON.stringify({
    v: 1,
    sessionId: SESSION,
    resolvedModel: 'claude-haiku-4-5-20251001',
    spawnId: OLD,
    processModel: 'default',
    processFolders: [marbly.path],
    items: [
      { kind: 'user', id: 'u1', text: 'Read my app', attachments: 0, at: 1 },
      { kind: 'text', id: 't1', text: '[the docs](https://x.example/?d=1)', at: 2 },
    ],
    chat: { id: 'chat-old', projectId: 'p1', projectName: 'P1', createdAt: 1, folders: [marbly] },
  })
);

test('a reload takes back a busy process with its folders, and a removal waits for that', async () => {
  let answerList: (rows: unknown) => void = () => {};
  answers.abs_claude_list = () => new Promise((resolve) => (answerList = resolve));
  claudeAgent.subscribe(() => {});
  await settle();

  // Rust has not answered: the process looks stopped, but the saved chat has
  // folders, so its agent may have read them.
  assert.equal(snap().session.status, 'stopped');
  assert.equal(claudeAgent.agentReadsFolders(), false);
  assert.equal(claudeAgent.agentMayHoldFolderData(), true);
  assert.equal(toAgentPanelView(snap(), null).linksAsText, true);

  // The process may be mid-turn and reading, so a removal waits for Rust.
  const removal = claudeAgent.removeFolder(marbly.path);
  await settle();
  assert.deepEqual(snap().chat.folders, [marbly], 'nothing changes before Rust answers');
  answerList([{ spawnId: OLD, busy: true, folders: [marbly.path] }]);
  assert.equal(await removal, false, 'refused, as during any running turn');
  assert.deepEqual(snap().chat.folders, [marbly]);
  assert.equal(callsTo('abs_claude_stop').length, 0);
  assert.equal(callsTo('abs_claude_forget_folder').length, 0);
  resetAnswers();

  assert.equal(snap().session.status, 'working');
  assert.equal(claudeAgent.agentReadsFolders(), true);
  assert.equal(snap().foldersLive, true);
  assert.equal(snap().foldersPending, false, 'the process reads the folder the chat holds');
  endTurn('r1', OLD);
  assert.equal(snap().session.status, 'ready');

  // The same folders: the next message goes to the same process, with no line.
  await claudeAgent.send({ text: 'Bigger headline' });
  assert.equal(callsTo('abs_claude_start').length, 0);
  assert.equal(callsTo('abs_claude_send').at(-1)!.args.spawnId, OLD);
  assert.equal(sentTexts().at(-1), 'Bigger headline');
  endTurn('r2', OLD);

  // Another folder: the process restarts with both, on the same conversation.
  answers.abs_claude_pick_folder = () => web;
  await claudeAgent.pickFolder({ addToChat: true });
  resetAnswers();
  await claudeAgent.send({ text: 'Use both' });
  assert.deepEqual(callsTo('abs_claude_stop').map((entry) => entry.args.spawnId), [OLD]);
  assert.deepEqual(lastStart().folders, [marbly.path, web.path]);
  assert.equal(lastStart().resume, SESSION);
  assert.ok(sentTexts().at(-1)!.startsWith(`${FOLDERS_CHANGED_NOTE}\n\nUse both`));
  endTurn('r3');

  // Removing a folder between turns now ends access at once.
  assert.equal(await claudeAgent.removeFolder(web.path), true);
  assert.deepEqual(callsTo('abs_claude_stop').map((entry) => entry.args.spawnId), [OLD, lastStart().spawnId]);
});
