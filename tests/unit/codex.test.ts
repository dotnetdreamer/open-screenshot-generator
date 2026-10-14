// The Codex agent's pure parts: folding the app-server's notifications into a
// transcript, and the effort level a turn goes out with. The fixtures are
// what codex.rs relays from a real Codex 0.162 app-server, run against a
// stand-in model and a stand-in design server (the model's answers are
// scripted; every notification is Codex's own): a turn of four design tool
// calls and a streamed reply, a turn stopped mid-tool, and turns the model's
// side refused with a 401 and with the plan's usage limit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { appendUserTurn } from '@/lib/claudeCode/streamReducer';
import { INITIAL_AGENT_STATE, type AgentItem, type AgentSessionState } from '@/lib/claudeCode/types';
import { toolLabel } from '@/lib/claudeCode/toolLabels';
import { contextMeter } from '@/lib/claudeCode/contextUsage';
import {
  CODEX_COMPACTED_NOTICE,
  CODEX_NO_RUNNER_NOTICE,
  CODEX_NO_TOOLS_NOTICE,
  CODEX_SIGN_IN_MESSAGE,
  describeCodexError,
  describeCodexExit,
  failCodexTurn,
  reduceCodexNotification,
} from '@/lib/codex/reducer';
import { clampCodexEffort } from '@/lib/codex/effort';
import { codexModelChoices } from '@/lib/claudeCode/view';

type Line = { method: string; params: unknown } | { start: { threadId: string; model: string; resumed: boolean } };

function fixture(name: string): Line[] {
  return fs
    .readFileSync(path.join(process.cwd(), 'tests', 'unit', 'fixtures', 'codex', `${name}.jsonl`), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Line);
}

/** A turn played into a fresh chat the way the store does it: the user's words first, then every notification. */
function replay(name: string, upTo?: number): AgentSessionState {
  const lines = fixture(name);
  const start = lines.find((line): line is Extract<Line, { start: unknown }> => 'start' in line)!;
  let state: AgentSessionState = appendUserTurn(
    { ...INITIAL_AGENT_STATE, sessionId: start.start.threadId, model: start.start.model },
    { id: 'u1', text: 'Make the headline say Track every drop', attachments: 0 },
    1000
  );
  const notifications = lines.filter((line): line is Extract<Line, { method: string }> => 'method' in line);
  notifications.slice(0, upTo).forEach((line, index) => {
    state = reduceCodexNotification(state, line.method, line.params, 2000 + index, { threadId: start.start.threadId });
  });
  return state;
}

const tools = (state: AgentSessionState) => state.items.filter((item): item is Extract<AgentItem, { kind: 'tool' }> => item.kind === 'tool');
const texts = (state: AgentSessionState) => state.items.filter((item) => item.kind === 'text').map((item) => (item as { text: string }).text);
const notices = (state: AgentSessionState) =>
  state.items.filter((item): item is Extract<AgentItem, { kind: 'notice' }> => item.kind === 'notice');

test('a turn of design tool calls reads as rows, one reply and a context reading', () => {
  const state = replay('tool-turn');
  assert.equal(state.status, 'ready');
  assert.equal(state.turnStartedAt, null);
  assert.equal(state.toolsConnected, true);
  const rows = tools(state);
  assert.deepEqual(
    rows.map((row) => [row.name, row.status]),
    [
      ['list_artboards', 'done'],
      ['get_artboard', 'error'],
      ['update_element', 'done'],
      ['export_png', 'done'],
    ]
  );
  // The failed call keeps the server's words, which is what the agent fixes from.
  assert.equal(rows[1].result, 'No such artboard.');
  assert.equal(rows[2].detail, '"Track every drop"');
  assert.equal(toolLabel(rows[2].name, rows[2].status), 'Edited an element');
  // export_png's picture stays on its row, as with Claude Code.
  assert.match(rows[3].image ?? '', /^data:image\/png;base64,iVBOR/);
  assert.equal(rows[3].detail, '30%');
  assert.deepEqual(texts(state), ['I changed the headline on Screen 1 to Track every drop.']);
  // The last call's prompt and output, against the window Codex reports.
  assert.deepEqual(state.context, { used: 2020, window: 258400, model: 'gpt-6.1-sol' });
  assert.equal(contextMeter(state.context, { agentName: 'Codex' }).label, '1%');
  assert.equal(notices(state).length, 0);
  assert.equal(state.lastTurn?.costUsd, null);
});

test('a reply grows with its deltas and the finished one replaces them', () => {
  const lines = fixture('tool-turn').filter((line) => 'method' in line) as { method: string; params: unknown }[];
  const firstDelta = lines.findIndex((line) => line.method === 'item/agentMessage/delta');
  const partial = replay('tool-turn', firstDelta + 4);
  assert.deepEqual(texts(partial), ['I changed the headline']);
  assert.equal(partial.status, 'working');
  // An agentMessage that starts empty adds nothing until its first words.
  const started = replay('tool-turn', firstDelta);
  assert.equal(texts(started).length, 0);
});

test('a turn stopped mid-tool ends as Stopped, with the tool settled', () => {
  const state = replay('interrupt');
  assert.equal(state.status, 'ready');
  assert.deepEqual(tools(state).map((row) => row.status), ['done']);
  assert.deepEqual(notices(state).map((notice) => [notice.tone, notice.text]), [['info', 'Stopped']]);
});

test('a login the model side refuses says to sign in, once', () => {
  const state = replay('unauthorized');
  assert.equal(state.status, 'ready');
  assert.deepEqual(notices(state).map((notice) => notice.text), [CODEX_SIGN_IN_MESSAGE]);
  assert.equal(state.error, null);
});

test('the plan usage limit is named as such', () => {
  const state = replay('usage-limit');
  assert.deepEqual(notices(state).map((notice) => notice.text), [
    'Your ChatGPT plan hit its Codex usage limit. Try again when it resets',
  ]);
});

test('a sub-agent and anything unknown leave the chat alone', () => {
  const state = replay('tool-turn');
  const other = { threadId: 'some-sub-agent', item: { type: 'agentMessage', id: 'x', text: 'I am a helper' } };
  assert.equal(reduceCodexNotification(state, 'item/completed', other, 9000, { threadId: state.sessionId }), state);
  assert.equal(reduceCodexNotification(state, 'thread/status/changed', { threadId: state.sessionId }, 9000), state);
  assert.equal(reduceCodexNotification(state, 'something/new', { a: 1 }, 9000), state);
  assert.equal(reduceCodexNotification(state, 'item/completed', null, 9000), state);
});

test('design tools that do not connect, a missing runner, and a refused command each get a word', () => {
  let state: AgentSessionState = { ...INITIAL_AGENT_STATE, status: 'working' };
  const failed = { name: 'osg-editor', status: 'failed', error: 'connection refused' };
  state = reduceCodexNotification(state, 'mcpServer/startupStatus/updated', failed, 1);
  state = reduceCodexNotification(state, 'mcpServer/startupStatus/updated', failed, 2);
  assert.equal(state.toolsConnected, false);
  assert.deepEqual(notices(state).map((notice) => notice.text), [CODEX_NO_TOOLS_NOTICE]);
  // Another server's state says nothing about the design tools.
  assert.equal(reduceCodexNotification(state, 'mcpServer/startupStatus/updated', { name: 'other', status: 'ready' }, 3), state);

  const warning = {
    threadId: null,
    message: 'Code Mode is unavailable because code-mode host is disabled. Code mode will fail closed.',
  };
  state = reduceCodexNotification(state, 'warning', warning, 4);
  state = reduceCodexNotification(state, 'warning', warning, 5);
  assert.equal(notices(state).filter((notice) => notice.text === CODEX_NO_RUNNER_NOTICE).length, 1);

  const command = { item: { type: 'commandExecution', id: 'c1', command: 'cat ~/.ssh/id_rsa', status: 'declined' } };
  state = reduceCodexNotification(state, 'item/completed', command, 6);
  assert.equal(notices(state).at(-1)?.text, 'Codex tried to run a command, which the app does not allow');
  assert.equal(tools(state).length, 0, 'no row offers the command as something done');
});

test('rate limits, a summary and a reroute', () => {
  let state: AgentSessionState = { ...INITIAL_AGENT_STATE, status: 'working', model: 'gpt-6.1-sol', context: { used: 90000, window: 258400, model: 'gpt-6.1-sol' } };
  state = reduceCodexNotification(state, 'account/rateLimits/updated', {
    rateLimits: { limitId: 'codex', primary: { usedPercent: 93, windowDurationMins: 10080, resetsAt: 1792502779 }, secondary: null },
  }, 1);
  assert.deepEqual(state.rateLimit, { status: 'allowed_warning', resetsAt: 1792502779, type: 'codex' });
  state = reduceCodexNotification(state, 'account/rateLimits/updated', {
    rateLimits: { limitId: 'codex', primary: { usedPercent: 100, resetsAt: 1792502779 }, rateLimitReachedType: 'rate_limit_reached' },
  }, 2);
  assert.equal(state.rateLimit?.status, 'rejected');

  state = reduceCodexNotification(state, 'thread/compacted', { threadId: 't', turnId: 'turn-1' }, 3);
  state = reduceCodexNotification(state, 'item/completed', { item: { type: 'contextCompaction', id: 'turn-1' } }, 4);
  assert.equal(state.context?.used, null, 'unknown until the next call measures it');
  assert.equal(state.context?.window, 258400);
  assert.equal(notices(state).filter((notice) => notice.text === CODEX_COMPACTED_NOTICE).length, 1, 'one summary, one notice');

  state = reduceCodexNotification(state, 'model/rerouted', { turnId: 'turn-2', fromModel: 'gpt-6.1-sol', toModel: 'gpt-6-luna' }, 5);
  assert.equal(state.model, 'gpt-6-luna');
});

test('a retry is said once, and an error inside a turn waits for the turn to end', () => {
  let state: AgentSessionState = { ...INITIAL_AGENT_STATE, status: 'working', turnStartedAt: 1 };
  const busy = { error: { message: 'stream disconnected', codexErrorInfo: 'serverOverloaded' }, willRetry: true };
  state = reduceCodexNotification(state, 'error', busy, 1);
  state = reduceCodexNotification(state, 'error', busy, 2);
  assert.deepEqual(notices(state).map((notice) => notice.text), ['Codex is busy, retrying']);
  state = reduceCodexNotification(state, 'error', { error: { message: 'gone', codexErrorInfo: 'serverOverloaded' }, willRetry: false }, 3);
  assert.equal(notices(state).length, 1, 'said when the turn ends');
  state = reduceCodexNotification(state, 'turn/completed', { turn: { id: 'turn-1', status: 'failed', error: null } }, 4);
  assert.equal(notices(state).at(-1)?.text, 'Codex is busy right now. Try again in a moment');
  assert.equal(state.status, 'ready');
});

test('errors, refusals and exits in words', () => {
  assert.equal(describeCodexError({ message: 'x', codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 401 } } }), CODEX_SIGN_IN_MESSAGE);
  assert.equal(describeCodexError({ message: 'x', codexErrorInfo: 'unauthorized' }), CODEX_SIGN_IN_MESSAGE);
  assert.equal(describeCodexError({ message: 'x', codexErrorInfo: 'contextWindowExceeded' }), 'This chat is too long for the model. Start a new chat to carry on');
  assert.equal(describeCodexError({ message: 'Model not found', codexErrorInfo: 'badRequest' }), 'Model not found');
  assert.equal(describeCodexError(null), null);
  const refused = failCodexTurn({ ...INITIAL_AGENT_STATE, status: 'working', turnStartedAt: 5 }, 'Codex refused the request', 10);
  assert.equal(refused.status, 'ready');
  assert.equal(notices(refused).at(-1)?.text, 'Codex refused the request');
  assert.equal(describeCodexExit(1, ['Error: Not logged in. Run codex login']), CODEX_SIGN_IN_MESSAGE);
  assert.equal(describeCodexExit(101, ['thread panicked at x', 'note: run with RUST_BACKTRACE=1']), 'Codex stopped: note: run with RUST_BACKTRACE=1');
  assert.equal(describeCodexExit(null, []), 'Codex stopped');
});

test('clipped Codex messages keep complete emoji for detached-panel IPC', () => {
  const atBoundary = (limit: number) => `${'x'.repeat(limit - 1)}🎉!`;
  const expected = (limit: number) => `${'x'.repeat(limit - 1)}…`;
  for (const limit of [80, 400]) {
    const state = reduceCodexNotification(INITIAL_AGENT_STATE, 'warning', { message: atBoundary(limit) }, 1);
    const [notice] = notices(state);
    assert.doesNotThrow(() => encodeURIComponent(notice.id));
    assert.doesNotThrow(() => encodeURIComponent(notice.text));
  }
  assert.equal(describeCodexError({ message: atBoundary(400) }), expected(400));
  assert.equal(describeCodexExit(1, [atBoundary(300)]), `Codex stopped: ${expected(300)}`);
  const state = reduceCodexNotification(INITIAL_AGENT_STATE, 'item/completed', {
    item: {
      type: 'mcpToolCall', id: 'emoji-result', server: 'osg-editor', tool: 'get_artboard', status: 'completed',
      result: { content: [{ type: 'text', text: atBoundary(1200) }] },
    },
  }, 1);
  assert.equal(tools(state)[0].result, expected(1200));
});

test('a turn asks for the effort picked, or the highest its model has below it', () => {
  assert.equal(clampCodexEffort('max', ['low', 'medium', 'high', 'xhigh', 'max']), 'max');
  assert.equal(clampCodexEffort('max', ['low', 'medium', 'high', 'xhigh']), 'xhigh');
  assert.equal(clampCodexEffort('high', ['low', 'max']), 'low');
  assert.equal(clampCodexEffort('minimal', ['low', 'medium']), 'low', 'nothing below it: the weakest it has');
  assert.equal(clampCodexEffort('medium', []), 'medium', 'a model nobody has detected');
  const models = codexModelChoices({
    found: true,
    models: [
      { id: 'gpt-6.1-sol', displayName: 'GPT-6.1-Sol', efforts: ['low', 'max'], isDefault: true },
      { id: 'gpt-6-luna', displayName: 'GPT-6-Luna', efforts: ['low', 'medium'], isDefault: false },
    ],
  });
  assert.deepEqual(models.map((model) => [model.value, model.efforts]), [
    ['default', ['low', 'max']],
    ['gpt-6.1-sol', ['low', 'max']],
    ['gpt-6-luna', ['low', 'medium']],
  ]);
});
