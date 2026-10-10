// A reload brings back the chat's context reading and the windows learned
// before it, so the ring is there before the next message and the first call
// on another model shows against that model's own window. In a file of its
// own, because the store reads the save once, on its first call.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SESSION, lastStart, play, settle, storage } from './helpers/claudeDesktop';
import { claudeAgent } from '@/lib/claudeCode/store';
import { toAgentPanelView } from '@/lib/claudeCode/view';

const HAIKU = 'claude-haiku-4-5-20251001';
const OPUS = 'claude-opus-5-5';
const snap = () => claudeAgent.getSnapshot();

storage.set(
  'osg-claude-agent-v1',
  JSON.stringify({
    v: 1,
    sessionId: SESSION,
    resolvedModel: HAIKU,
    spawnId: null,
    items: [{ kind: 'user', id: 'u1', text: 'Make it dark', attachments: 0, at: 1 }],
    chat: { id: 'chat-1', projectId: 'p1', projectName: 'P1', createdAt: 1, folders: [], readFolders: false, ranFolders: null },
    context: { used: 52000, window: 200000, model: HAIKU },
  })
);
storage.set('osg-claude-agent-windows', JSON.stringify({ [HAIKU]: 200000, [OPUS]: 1_000_000, broken: 'x' }));

test('a reload keeps the reading and the windows learned before it', async () => {
  claudeAgent.subscribe(() => {});
  await settle();
  assert.deepEqual(snap().session.context, { used: 52000, window: 200000, model: HAIKU });
  assert.equal(toAgentPanelView(snap(), null).context?.used, 52000);

  // The next message runs on Opus. Its first call shows against the window
  // Opus reported before the reload, not Haiku's.
  claudeAgent.setModel('opus');
  await claudeAgent.send({ text: 'Bigger headline' });
  assert.equal(lastStart().resume, SESSION);
  play({ type: 'system', subtype: 'init', session_id: SESSION, model: OPUS, mcp_servers: [{ name: 'osg-editor', status: 'connected' }], uuid: 'i1' });
  play({
    type: 'assistant',
    uuid: 'a1',
    message: {
      model: OPUS,
      id: 'm1',
      content: [{ type: 'text', text: 'Done' }],
      usage: { input_tokens: 4, cache_creation_input_tokens: 48000, cache_read_input_tokens: 2500, output_tokens: 3 },
    },
  });
  assert.deepEqual(snap().session.context, { used: 50507, window: 1_000_000, model: OPUS });
});
