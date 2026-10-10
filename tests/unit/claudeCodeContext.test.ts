// The context ring's reading in the store, driven end to end in node like
// claudeCodeStore.test.ts: a window one turn reports shows the next chat's ring
// from its first call, each chat keeps its own reading in Past chats, a
// conversation Claude Code no longer has takes its reading with it, and a new
// process is asked about its context window when its Claude Code answers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SESSION, answers, callsTo, play, resetAnswers, rows, settle, storage } from './helpers/claudeDesktop';
import { claudeAgent } from '@/lib/claudeCode/store';
import { toAgentPanelView } from '@/lib/claudeCode/view';

const OPUS = 'claude-opus-5-5';
const snap = () => claudeAgent.getSnapshot();

type Call = { input: number; written: number; read: number; output: number };

const usage = (call: Call, output = call.output) => ({
  input_tokens: call.input,
  cache_creation_input_tokens: call.written,
  cache_read_input_tokens: call.read,
  output_tokens: output,
});

/** A turn's opening and one model call, its output partly written, the way Claude Code 2.1.285 prints them. */
function call(uuid: string, tokens: Call): void {
  play({
    type: 'system',
    subtype: 'init',
    session_id: SESSION,
    model: OPUS,
    mcp_servers: [{ name: 'osg-editor', status: 'connected' }],
    apiKeySource: 'none',
    uuid: `i-${uuid}`,
  });
  play({
    type: 'assistant',
    uuid: `a-${uuid}`,
    message: { model: OPUS, id: `m-${uuid}`, content: [{ type: 'text', text: 'Done' }], usage: usage(tokens, 2) },
  });
}

/** The turn's result: its last call with the final output, and the model's window. */
function end(uuid: string, tokens: Call): void {
  play({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'Done',
    num_turns: 1,
    session_id: SESSION,
    uuid: `r-${uuid}`,
    usage: { ...usage(tokens), iterations: [{ ...usage(tokens), type: 'message' }] },
    modelUsage: { [OPUS]: { inputTokens: tokens.input, outputTokens: tokens.output, contextWindow: 1_000_000, maxOutputTokens: 128000 } },
  });
}

test('a chat keeps its reading, and a window learned once shows a new chat from its first call', async () => {
  claudeAgent.subscribe(() => {});
  await claudeAgent.newChat({ projectId: 'p1', projectName: 'P1' });
  assert.equal(snap().session.context, null, 'nothing measured yet');

  await claudeAgent.send({ text: 'Make it dark' });
  const first = { input: 2, written: 2175, read: 1452, output: 1145 };
  call('1', first);
  // No result has said how big Opus's window is, so the ring waits.
  assert.deepEqual(snap().session.context, { used: 3631, window: null, model: OPUS });
  assert.equal(toAgentPanelView(snap(), null).context?.window, null);
  end('1', first);
  assert.deepEqual(snap().session.context, { used: 4774, window: 1_000_000, model: OPUS });
  assert.deepEqual(JSON.parse(storage.get('osg-claude-agent-windows')!), { [OPUS]: 1_000_000 });
  const chatId = snap().chat.id!;

  // Leaving the chat saves its reading with it, and the new chat starts empty.
  await claudeAgent.newChat({ projectId: 'p1', projectName: 'P1' });
  assert.deepEqual(rows.get(chatId)?.context, { used: 4774, window: 1_000_000, model: OPUS });
  assert.equal(snap().session.context, null);

  // Its first call shows at once, against the window Opus reported before.
  await claudeAgent.send({ text: 'Another set' });
  const second = { input: 3, written: 0, read: 3627, output: 40 };
  call('2', second);
  assert.deepEqual(snap().session.context, { used: 3632, window: 1_000_000, model: OPUS });
  assert.equal(toAgentPanelView(snap(), null).context?.used, 3632);
  end('2', second);

  // Opening the first chat again brings its own reading back.
  assert.equal(await claudeAgent.openChat(chatId), true);
  assert.deepEqual(snap().session.context, { used: 4774, window: 1_000_000, model: OPUS });
});

test('a conversation Claude Code no longer has takes its reading with it', async () => {
  await claudeAgent.newChat({ projectId: 'p2', projectName: 'P2' });
  await claudeAgent.send({ text: 'Start' });
  const tokens = { input: 2, written: 3000, read: 0, output: 500 };
  call('3', tokens);
  end('3', tokens);
  assert.equal(snap().session.context?.used, 3502);
  const chatId = snap().chat.id!;

  // Back to the chat later: its reading is there, and the next message
  // resumes a conversation Claude Code has since pruned. It answers with an
  // error result before any init, and the store starts a fresh one.
  await claudeAgent.newChat({ projectId: 'p2', projectName: 'P2' });
  assert.equal(await claudeAgent.openChat(chatId), true);
  assert.equal(snap().session.context?.used, 3502);
  const starts = callsTo('abs_claude_start').length;
  await claudeAgent.send({ text: 'Carry on' });
  assert.equal(callsTo('abs_claude_start').length, starts + 1);
  assert.equal(callsTo('abs_claude_start').at(-1)!.args.args.resume, SESSION);
  play({
    type: 'result',
    subtype: 'error_during_execution',
    is_error: true,
    errors: [`No conversation found with session ID: ${SESSION}`],
    uuid: 'r-gone',
  });
  await settle();
  assert.equal(callsTo('abs_claude_start').length, starts + 2, 'started again as a new conversation');
  assert.equal(callsTo('abs_claude_start').at(-1)!.args.args.resume, undefined);
  assert.equal(snap().session.context, null, 'the reading was of the conversation that is gone');
});

/** The lines written to stdin since `from`, parsed. */
const linesSince = (from: number) => callsTo('abs_claude_send').slice(from).map((entry) => JSON.parse(String(entry.args.line)));

test('a new process is asked about its context window before the message, and again after a summary', async () => {
  answers.abs_claude_detect = () => ({ found: true, version: '2.1.285 (Claude Code)', loggedIn: true, authMethod: 'claude.ai' });
  await claudeAgent.detect(true);
  await claudeAgent.newChat({ projectId: 'p3', projectName: 'P3' });
  const from = callsTo('abs_claude_send').length;
  await claudeAgent.send({ text: 'Start' });
  const lines = linesSince(from);
  // The question first, so the message stays the last line Rust compares an IPC retry with.
  assert.deepEqual(lines.map((line) => line.type), ['control_request', 'user']);
  assert.deepEqual(lines[0].request, { subtype: 'get_context_usage' });
  assert.ok(String(lines[0].request_id).startsWith('context-'));

  // The answer comes before any model call, and the ring shows the window and
  // what the system prompt and skills take.
  play({
    type: 'control_response',
    response: { subtype: 'success', request_id: lines[0].request_id, response: { model: OPUS, totalTokens: 4387, rawMaxTokens: 1_000_000, apiUsage: null } },
  });
  assert.deepEqual(snap().session.context, { used: 4387, window: 1_000_000, model: OPUS });

  // A summary in the middle of the turn: asked again at once.
  play({
    type: 'system',
    subtype: 'compact_boundary',
    session_id: SESSION,
    uuid: 'cb-1',
    compact_metadata: { trigger: 'auto', pre_tokens: 940000, post_tokens: 21000 },
  });
  await settle();
  const after = linesSince(from);
  assert.equal(after.length, 3);
  assert.deepEqual(after[2].request, { subtype: 'get_context_usage' });
  assert.equal(snap().session.context?.used, null, 'unknown until the answer or the next call');

  // The next message goes to the same process, so nothing more is asked.
  end('4', { input: 2, written: 1000, read: 20000, output: 300 });
  const sent = callsTo('abs_claude_send').length;
  await claudeAgent.send({ text: 'Carry on' });
  assert.deepEqual(linesSince(sent).map((line) => line.type), ['user']);
  end('5', { input: 2, written: 500, read: 21000, output: 100 });
  resetAnswers();
});

test('an older Claude Code is never asked', async () => {
  answers.abs_claude_detect = () => ({ found: true, version: '2.1.202 (Claude Code)', loggedIn: true, authMethod: 'claude.ai' });
  await claudeAgent.detect(true);
  await claudeAgent.newChat({ projectId: 'p4', projectName: 'P4' });
  const from = callsTo('abs_claude_send').length;
  await claudeAgent.send({ text: 'Start' });
  assert.deepEqual(linesSince(from).map((line) => line.type), ['user']);
  play({ type: 'system', subtype: 'compact_boundary', session_id: SESSION, uuid: 'cb-2', compact_metadata: { trigger: 'auto' } });
  await settle();
  assert.deepEqual(linesSince(from).map((line) => line.type), ['user']);
  end('6', { input: 2, written: 500, read: 3000, output: 100 });
  resetAnswers();
});
