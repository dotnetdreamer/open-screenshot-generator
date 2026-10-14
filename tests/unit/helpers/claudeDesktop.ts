// A stand-in for the desktop app around the agent store, in node: the IPC
// answers Rust would give for Claude Code and for Codex, each process's output
// played back through the same event, localStorage, and the two IndexedDB
// tables the store writes.
// Each test file is bundled on its own, so each one that imports this gets
// its own copy of it and of the store, hydrated by its first call.

import assert from 'node:assert/strict';
import { db } from '@/database';
import type { AgentChatRecord } from '@/lib/claudeCode/chats';
import type { Operation } from '@/lib/ai/operationLog';

export type Invoke = { cmd: string; args: Record<string, any> };
export type Answer = (args: Record<string, any>) => unknown;

export const NONCE = 'nonce-e2e';
/** The conversation id every played init reports. */
export const SESSION = '6e6cdc77-0d28-43a0-955d-9cad1fb02032';
export const marbly = { name: 'Marbly', path: '/Users/me/code/Marbly' };
/** The thread every Codex start opens, unless a test answers otherwise. */
export const CODEX_THREAD = '01a13963-abeb-7f92-b6ea-64f6cb531353';
/** What Codex detection finds: signed in on Plus, two models with different effort levels. */
export const CODEX_READY = {
  found: true,
  path: '/opt/homebrew/bin/codex',
  version: 'codex-cli 0.162.0',
  loggedIn: true,
  authMethod: 'chatgpt',
  planType: 'plus',
  models: [
    { id: 'gpt-6.1-sol', displayName: 'GPT-6.1-Sol', efforts: ['low', 'medium', 'high', 'xhigh'], defaultEffort: 'low', isDefault: true },
    { id: 'gpt-6-luna', displayName: 'GPT-6-Luna', efforts: ['low', 'medium'], defaultEffort: 'medium', isDefault: false },
  ],
};
export const web = { name: 'web', path: '/Users/me/code/web' };

export const invokes: Invoke[] = [];
const callbacks = new Map<number, (event: unknown) => void>();
let callbackSeq = 1;
export const storage = new Map<string, string>();

export const defaults: Record<string, Answer> = {
  abs_mcp_bridge_nonce: () => NONCE,
  abs_claude_page_epoch: () => 1,
  abs_claude_list: () => [],
  abs_claude_start: () => ({ pid: 4242, workspace: '/agent/session', mcpUrl: 'http://127.0.0.1:8722/mcp', missingFolders: [] }),
  abs_claude_send: () => null,
  abs_claude_stop: () => null,
  abs_claude_pick_folder: () => marbly,
  abs_claude_forget_folder: () => null,
  abs_codex_page_epoch: () => 1,
  abs_codex_list: () => [],
  abs_codex_detect: () => CODEX_READY,
  abs_codex_start: (args) => ({
    pid: 5151,
    threadId: args.args.resume ?? CODEX_THREAD,
    resumed: !!args.args.resume,
    model: args.args.model ?? 'gpt-6.1-sol',
    mcpUrl: 'http://127.0.0.1:8722/mcp',
  }),
  abs_codex_send: () => null,
  abs_codex_interrupt: () => null,
  abs_codex_stop: () => null,
  'plugin:event|listen': () => 1,
};
/** What each command answers now. A test changes an entry and calls resetAnswers when done. */
export const answers: Record<string, Answer> = { ...defaults };

export function resetAnswers(): void {
  for (const cmd of Object.keys(answers)) delete answers[cmd];
  Object.assign(answers, defaults);
}

// What the webview gives the page in the desktop app, before the store first runs.
Object.assign(globalThis, {
  window: globalThis,
  localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, String(value)),
    removeItem: (key: string) => void storage.delete(key),
  },
  __TAURI_INTERNALS__: {
    invoke: async (cmd: string, args: Record<string, any> = {}) => {
      invokes.push({ cmd, args });
      const answer = answers[cmd];
      if (!answer) throw new Error(`The stand-in does not model ${cmd}`);
      return answer(args);
    },
    transformCallback: (callback: (event: unknown) => void) => {
      const id = callbackSeq++;
      callbacks.set(id, callback);
      return id;
    },
    unregisterCallback: (id: number) => void callbacks.delete(id),
  },
});

// No IndexedDB in node. Past chats get a table in memory with the calls the
// store makes, and the run log keeps every row it writes.
export const rows = new Map<string, AgentChatRecord>();
export const operations = new Map<string, Operation>();
function ordered(list: AgentChatRecord[]) {
  return {
    reverse: () => ordered([...list].reverse()),
    limit: (count: number) => ordered(list.slice(0, count)),
    toArray: async () => list.map((row) => structuredClone(row)),
    primaryKeys: async () => list.map((row) => row.id),
  };
}
Object.assign(db, {
  agentChats: {
    put: async (row: AgentChatRecord) => void rows.set(row.id, structuredClone(row)),
    get: async (id: string) => (rows.has(id) ? structuredClone(rows.get(id)) : undefined),
    delete: async (id: string) => void rows.delete(id),
    count: async () => rows.size,
    bulkDelete: async (ids: string[]) => ids.forEach((id) => rows.delete(id)),
    orderBy: (key: 'updatedAt') => ordered([...rows.values()].sort((a, b) => a[key] - b[key])),
  },
  operations: {
    put: async (row: Operation) => void operations.set(row.id, structuredClone(row)),
  },
});

export const callsTo = (cmd: string) => invokes.filter((entry) => entry.cmd === cmd);
export const lastStart = () => callsTo('abs_claude_start').at(-1)!.args.args as Record<string, any>;
export const sentTexts = () =>
  callsTo('abs_claude_send')
    .map((entry) => JSON.parse(String(entry.args.line)))
    .filter((line) => line.type === 'user')
    .map((line) => line.message.content[0].text as string);

/** One line of stdout from a process, the latest one started unless named, the way Rust relays it. */
export function play(message: Record<string, unknown>, spawnId: string = lastStart().spawnId): void {
  const listen = callsTo('plugin:event|listen').find((entry) => entry.args.event === 'abs-claude-event');
  assert.ok(listen, 'the store listens before anything starts');
  callbacks.get(listen.args.handler as number)!({
    event: 'abs-claude-event',
    id: 1,
    payload: { spawnId, kind: 'stdout', line: JSON.stringify(message), nonce: NONCE },
  });
}

export const lastCodexStart = () => callsTo('abs_codex_start').at(-1)!.args.args as Record<string, any>;
/** What each Codex turn went out with: text, pictures, model and effort. */
export const codexTurns = () => callsTo('abs_codex_send').map((entry) => entry.args.turn as Record<string, any>);

/** One event from a Codex process, the latest one started unless named, the way codex.rs relays it. */
export function playCodex(
  event: Record<string, unknown> & { kind: string },
  spawnId: string = lastCodexStart().spawnId
): void {
  const listen = callsTo('plugin:event|listen').find((entry) => entry.args.event === 'abs-codex-event');
  assert.ok(listen, 'the store listens to Codex before anything starts');
  callbacks.get(listen.args.handler as number)!({
    event: 'abs-codex-event',
    id: 1,
    payload: { spawnId, ...event, nonce: NONCE },
  });
}

/** A notification, as playCodex sends it. */
export const notify = (method: string, params: Record<string, unknown>, spawnId?: string) =>
  playCodex({ kind: 'notification', method, params }, spawnId);

/** The end of a Codex turn: its reply, then turn/completed with the status given. */
export function endCodexTurn(turnId: string, status = 'completed', spawnId?: string): void {
  notify('turn/started', { threadId: CODEX_THREAD, turn: { id: turnId, status: 'inProgress', items: [] } }, spawnId);
  if (status === 'completed') {
    notify(
      'item/completed',
      { threadId: CODEX_THREAD, turnId, item: { type: 'agentMessage', id: `msg-${turnId}`, text: 'Done' } },
      spawnId
    );
  }
  notify('turn/completed', { threadId: CODEX_THREAD, turn: { id: turnId, status, items: [], durationMs: 1200 } }, spawnId);
}

export function endTurn(uuid: string, spawnId?: string): void {
  play(
    {
      type: 'system',
      subtype: 'init',
      session_id: SESSION,
      model: 'm',
      mcp_servers: [{ name: 'osg-editor', status: 'connected' }],
      uuid: `i-${uuid}`,
    },
    spawnId
  );
  play({ type: 'result', subtype: 'success', is_error: false, result: 'done', session_id: SESSION, uuid }, spawnId);
}

/** Let the promises already queued run, and whatever they queue in turn. */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
