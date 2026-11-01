// A reply that lands a moment before a reload stays in the chat. The store
// saves half a second after the last change, so a save still waiting is
// written as the page goes, and a desktop window closing (which fires no
// pagehide) flushes it through claudeAgent.flush. In a file of its own,
// because the store reads the save once, on its first call.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { play, rows, settle, storage } from './helpers/claudeDesktop';
import { claudeAgent } from '@/lib/claudeCode/store';

// The page's own events, which node's globalThis does not have. In place
// before the store's first call, which is when it starts listening.
const page = new EventTarget();
Object.assign(globalThis, {
  addEventListener: page.addEventListener.bind(page),
  removeEventListener: page.removeEventListener.bind(page),
  dispatchEvent: page.dispatchEvent.bind(page),
});

/** The agent's words in the chat saved for the next page load. */
const savedReplies = () => {
  const saved = JSON.parse(storage.get('osg-claude-agent-v1') ?? 'null') as {
    items: Array<{ kind: string; text?: string }>;
  } | null;
  return (saved?.items ?? []).filter((item) => item.kind === 'text').map((item) => item.text);
};

const reply = (id: string, text: string) =>
  play({ type: 'assistant', uuid: id, message: { id: `m-${id}`, content: [{ type: 'text', text }] } });

test('a reply that arrives just before the page goes is saved as it goes', async () => {
  claudeAgent.subscribe(() => {});
  await settle();
  await claudeAgent.newChat({ projectId: 'p1', projectName: 'P1' });
  await claudeAgent.send({ text: 'Make it dark' });
  reply('a1', 'Done, it is dark now');
  assert.deepEqual(savedReplies(), [], 'the save waits for the changes to go quiet');

  // A reload inside that half second.
  page.dispatchEvent(new Event('pagehide'));
  assert.deepEqual(savedReplies(), ['Done, it is dark now']);
});

test('a desktop window closing writes it through flush, Past chats included', async () => {
  reply('a2', 'And the headline is bigger');
  await claudeAgent.flush();
  assert.equal(savedReplies().at(-1), 'And the headline is bigger');
  const chatId = claudeAgent.getSnapshot().chat.id!;
  const items = rows.get(chatId)?.items ?? [];
  assert.equal(items.some((item) => item.kind === 'text' && item.text === 'And the headline is bigger'), true);
});
