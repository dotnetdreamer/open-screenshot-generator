// Folds Codex's app-server notifications into a conversation: the same
// AgentSessionState Claude Code's stream folds into, so the Agent panel draws
// either one.
//
// Pure: a state and one notification in, the next state out. No clock, no ids
// minted from randomness; `now` is passed in.
//
// What a turn looks like, as codex.rs relays it (Codex 0.162):
//   turn/started {turn: {id}}
//   mcpServer/startupStatus/updated {name: "osg-editor", status: "ready"}   (once per process)
//   item/started {item: {type: "mcpToolCall", id, server, tool, arguments, status: "inProgress"}}
//   item/completed {item: {..., status: "completed" | "failed", result: {content}, error}}
//   item/started {item: {type: "agentMessage", id, text}}, then item/agentMessage/delta {itemId, delta}...
//   item/completed {item: {type: "agentMessage", id, text}}
//   thread/tokenUsage/updated {tokenUsage: {last: {totalTokens, ...}, modelContextWindow}}
//   turn/completed {turn: {id, status: "completed" | "interrupted" | "failed", error, durationMs}}
// The model reaches the design tools by writing JavaScript for its exec tool.
// The script itself makes no item; each design tool it calls does.

import { MAX_ITEMS } from '@/lib/claudeCode/streamReducer';
import { toolDetail } from '@/lib/claudeCode/toolLabels';
import type { AgentItem, AgentRateLimit, AgentSessionState } from '@/lib/claudeCode/types';

/** Longest tool answer kept in the transcript. The panel shows a line of it. */
const MAX_RESULT_CHARS = 1200;

/** Where Codex says it reached the design tools. Must match MCP_SERVER_NAME in codex.rs. */
const DESIGN_SERVER = 'osg-editor';

export const CODEX_SIGN_IN_MESSAGE = 'Codex is not signed in. Run codex in a terminal, sign in, then send your message again';
export const CODEX_COMPACTED_NOTICE = 'Codex summarized the chat so far to free up context';
export const CODEX_NO_TOOLS_NOTICE =
  'Codex could not reach the design tools, so it cannot change the canvas. Start a new chat to try again';
/** What Codex warns when its JavaScript runner is missing, which leaves the model no way to any tool. */
export const CODEX_NO_RUNNER_NOTICE =
  'Codex could not start the runner it uses for tools, so it cannot change the canvas. Update Codex, then start a new chat';

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function trimItems(items: AgentItem[]): AgentItem[] {
  return items.length > MAX_ITEMS ? items.slice(items.length - MAX_ITEMS) : items;
}

function clip(text: string, max = MAX_RESULT_CHARS): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function withNotice(
  state: AgentSessionState,
  notice: { id: string; tone: 'info' | 'warning' | 'error'; text: string },
  now: number
): AgentSessionState {
  if (state.items.some((item) => item.id === notice.id)) return state;
  return { ...state, items: trimItems([...state.items, { kind: 'notice', ...notice, at: now }]) };
}

/** The item ids this reducer makes, apart from Claude Code's. */
function itemId(id: string): string {
  return `cx-${id}`;
}

/** Whether a message from Codex means its login is missing or expired. */
export function looksSignedOutCodex(text: string): boolean {
  return /not logged in|log in again|sign in again|codex login|unauthori[sz]ed|refresh token/i.test(text);
}

/** A turn's error, in words a person can act on. */
export function describeCodexError(error: unknown): string | null {
  if (!isObject(error)) return null;
  const message = str(error.message)?.trim() ?? '';
  const info = error.codexErrorInfo;
  const kind = typeof info === 'string' ? info : isObject(info) ? Object.keys(info)[0] : null;
  const detail = isObject(info) && kind && isObject(info[kind]) ? (info[kind] as Json) : null;
  const status = num(detail?.httpStatusCode);
  if (kind === 'unauthorized' || status === 401 || status === 403 || looksSignedOutCodex(message)) {
    return CODEX_SIGN_IN_MESSAGE;
  }
  if (kind === 'usageLimitExceeded') return 'Your ChatGPT plan hit its Codex usage limit. Try again when it resets';
  if (kind === 'contextWindowExceeded') return 'This chat is too long for the model. Start a new chat to carry on';
  if (kind === 'rateLimitExceeded' || status === 429) return 'Codex is getting too many requests. Try again in a moment';
  if (kind === 'serverOverloaded') return 'Codex is busy right now. Try again in a moment';
  return message ? clip(message, 400) : null;
}

/** Why a process that died in the middle of a turn died, for the transcript. */
export function describeCodexExit(code: number | null, stderrTail: string[]): string {
  const tail = stderrTail.map((line) => line.trim()).filter(Boolean);
  if (looksSignedOutCodex(tail.join('\n'))) return CODEX_SIGN_IN_MESSAGE;
  const last = [...tail].reverse().find((line) => !/^\s*at\s/.test(line));
  if (last) return `Codex stopped: ${last.length > 300 ? `${last.slice(0, 300)}…` : last}`;
  return code === null ? 'Codex stopped' : `Codex stopped (exit code ${code})`;
}

/** A tool result's text and its first picture, from MCP content blocks. */
function resultOf(content: unknown): { text: string; image?: string } {
  if (!Array.isArray(content)) return { text: '' };
  const parts: string[] = [];
  let image: string | undefined;
  for (const block of content) {
    if (!isObject(block)) continue;
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
    // Rust empties a picture too large to send to the panel, marking it elided.
    if (block.type === 'image' && !image && typeof block.data === 'string' && block.data) {
      image = `data:${str(block.mimeType) ?? 'image/png'};base64,${block.data}`;
    }
  }
  return { text: parts.join('\n'), image };
}

/** What a tool row of an item other than a design tool call is called. */
function rowName(item: Json): string | null {
  switch (item.type) {
    case 'mcpToolCall':
      return item.server === DESIGN_SERVER || !str(item.server) ? str(item.tool) : `${str(item.server)}:${str(item.tool)}`;
    case 'collabAgentToolCall':
      return 'helper_agent';
    case 'dynamicToolCall':
      return str(item.tool);
    case 'webSearch':
      return 'web_search';
    case 'imageGeneration':
      return 'image_generation';
    default:
      return null;
  }
}

function itemStatus(item: Json): 'running' | 'done' | 'error' {
  const status = str(item.status);
  if (status === 'inProgress') return 'running';
  if (status === 'failed' || status === 'declined' || status === 'interrupted') return 'error';
  return 'done';
}

/** A tool call starting or finishing, as a row. */
function foldToolItem(state: AgentSessionState, item: Json, done: boolean, now: number): AgentSessionState {
  const name = rowName(item);
  const id = str(item.id);
  if (!name || !id) return state;
  const input = isObject(item.arguments) ? item.arguments : {};
  const existing = state.items.find((entry) => entry.kind === 'tool' && entry.toolUseId === id);
  let status = done ? itemStatus(item) : 'running';
  if (done && status === 'running') status = 'done';
  const { text, image } = done ? resultOf(isObject(item.result) ? item.result.content : null) : { text: '' };
  const errorText = isObject(item.error) ? str(item.error.message) : null;
  const result = done ? clip((text || errorText || '').trim()) || undefined : undefined;
  // A design tool that answered proves the server is up, whatever its
  // startup status said.
  const connected = done && item.type === 'mcpToolCall' && item.server === DESIGN_SERVER && state.toolsConnected !== true;
  if (existing && existing.kind === 'tool') {
    if (!done) return state;
    const items = state.items.map((entry) =>
      entry === existing ? { ...existing, status, result, image, endedAt: now } : entry
    );
    return { ...state, items, ...(connected ? { toolsConnected: true } : {}) };
  }
  const row: AgentItem = {
    kind: 'tool',
    id: itemId(id),
    toolUseId: id,
    name,
    input,
    detail: toolDetail(name, input) ?? undefined,
    status,
    ...(done ? { result, image, endedAt: now } : {}),
    at: now,
  };
  return { ...state, items: trimItems([...state.items, row]), ...(connected ? { toolsConnected: true } : {}) };
}

/** A reply, whole or in part. Deltas build it up; item/completed has the final text. */
function foldMessage(state: AgentSessionState, id: string, text: string, replace: boolean, now: number): AgentSessionState {
  const key = itemId(id);
  const index = state.items.findIndex((item) => item.id === key);
  if (index < 0) {
    if (!text.trim()) return state;
    return { ...state, items: trimItems([...state.items, { kind: 'text', id: key, text, at: now }]) };
  }
  const current = state.items[index];
  if (current.kind !== 'text') return state;
  const next = replace ? text : current.text + text;
  if (next === current.text) return state;
  const items = [...state.items];
  if (!next.trim()) items.splice(index, 1);
  else items[index] = { ...current, text: next };
  return { ...state, items };
}

/** Questions the model asked through its async question tool, as lines of the reply. */
function questionLines(item: Json): string {
  if (!Array.isArray(item.questions)) return '';
  return item.questions
    .map((question) => (isObject(question) ? str(question.title)?.trim() : null))
    .filter((title): title is string => !!title)
    .map((title) => `- ${title}`)
    .join('\n');
}

function foldItem(state: AgentSessionState, item: Json, done: boolean, now: number): AgentSessionState {
  const id = str(item.id);
  switch (item.type) {
    case 'agentMessage': {
      if (!id) return state;
      const questions = done ? questionLines(item) : '';
      const text = [str(item.text) ?? '', questions].filter((part) => part.trim()).join('\n\n');
      return foldMessage(state, id, text, true, now);
    }
    case 'contextCompaction':
      return done ? compacted(state, `item-${id ?? now}`, now) : state;
    case 'commandExecution':
    case 'fileChange':
      // Neither is possible in the agent's sandbox, and approvals are refused.
      if (!done || !id) return state;
      return withNotice(
        state,
        {
          id: `notice-refused-${id}`,
          tone: 'warning',
          text:
            item.type === 'commandExecution'
              ? 'Codex tried to run a command, which the app does not allow'
              : 'Codex tried to change a file, which the app does not allow',
        },
        now
      );
    default:
      return foldToolItem(state, item, done, now);
  }
}

function compacted(state: AgentSessionState, key: string, now: number): AgentSessionState {
  // One summary can arrive both as an item and as thread/compacted, under
  // different ids, so a notice right before this one stands for both.
  const last = state.items[state.items.length - 1];
  const said = last?.kind === 'notice' && last.text === CODEX_COMPACTED_NOTICE;
  const next = said
    ? state
    : withNotice(state, { id: `notice-compact-${key}`, tone: 'info', text: CODEX_COMPACTED_NOTICE }, now);
  // What is left is unknown until the next call measures it.
  return next.context ? { ...next, context: { ...next.context, used: null } } : next;
}

/** The rate limit Codex reports, in the shape the panel reads for Claude Code's. */
function rateLimitOf(limits: Json, previous: AgentRateLimit | null): AgentRateLimit {
  const windows = [limits.primary, limits.secondary].filter(isObject);
  const used = Math.max(0, ...windows.map((window) => num(window.usedPercent) ?? 0));
  const reached = !!str(limits.rateLimitReachedType) || limits.spendControlReached === true;
  // The window that is fullest is the one that resets the limit.
  const fullest = windows.slice().sort((a, b) => (num(b.usedPercent) ?? 0) - (num(a.usedPercent) ?? 0))[0];
  return {
    status: reached ? 'rejected' : used >= 90 ? 'allowed_warning' : 'allowed',
    resetsAt: num(fullest?.resetsAt) ?? (reached ? (previous?.resetsAt ?? null) : null),
    type: str(limits.limitName) ?? str(limits.limitId),
  };
}

/** What the reducer needs to know beyond the notification. */
export interface CodexReduceOptions {
  /** The chat's conversation. A notification about another thread (a sub-agent's) is ignored. */
  threadId?: string | null;
}

/**
 * Apply one notification. Anything unrecognised returns the state as it was,
 * which is what makes a newer Codex's new notifications harmless.
 */
export function reduceCodexNotification(
  state: AgentSessionState,
  method: string,
  params: unknown,
  now: number,
  options: CodexReduceOptions = {}
): AgentSessionState {
  if (!isObject(params)) return state;
  const thread = str(params.threadId);
  if (options.threadId && thread && thread !== options.threadId) return state;

  switch (method) {
    case 'turn/started':
      return state.status === 'working' && state.turnStartedAt
        ? state
        : { ...state, status: 'working', turnStartedAt: state.turnStartedAt ?? now };

    case 'item/started':
    case 'item/completed':
      return isObject(params.item) ? foldItem(state, params.item, method === 'item/completed', now) : state;

    case 'item/agentMessage/delta': {
      const id = str(params.itemId);
      const delta = str(params.delta);
      return id && delta ? foldMessage(state, id, delta, false, now) : state;
    }

    case 'thread/tokenUsage/updated': {
      const usage = isObject(params.tokenUsage) ? params.tokenUsage : null;
      const last = isObject(usage?.last) ? usage.last : null;
      if (!last) return state;
      const used =
        num(last.totalTokens) ?? (num(last.inputTokens) ?? 0) + (num(last.outputTokens) ?? 0);
      const window = num(usage?.modelContextWindow) ?? state.context?.window ?? null;
      const model = state.model ?? state.context?.model ?? null;
      const { context } = state;
      if (context?.used === used && context.window === window && context.model === model) return state;
      return { ...state, context: { used, window, model } };
    }

    case 'account/rateLimits/updated':
      return isObject(params.rateLimits) ? { ...state, rateLimit: rateLimitOf(params.rateLimits, state.rateLimit) } : state;

    case 'mcpServer/startupStatus/updated': {
      if (params.name !== DESIGN_SERVER) return state;
      const status = str(params.status);
      if (status === 'ready') return state.toolsConnected === true ? state : { ...state, toolsConnected: true };
      if (status !== 'failed' && status !== 'cancelled') return state;
      const next: AgentSessionState = { ...state, toolsConnected: false };
      return state.toolsConnected === false
        ? next
        : withNotice(next, { id: `notice-tools-${now}`, tone: 'error', text: CODEX_NO_TOOLS_NOTICE }, now);
    }

    case 'error': {
      const message = describeCodexError(params.error) ?? 'Codex stopped with an error';
      if (params.willRetry === true) {
        const last = state.items[state.items.length - 1];
        if (last?.kind === 'notice' && last.text === 'Codex is busy, retrying') return state;
        return withNotice(state, { id: `notice-retry-${now}`, tone: 'info', text: 'Codex is busy, retrying' }, now);
      }
      // Inside a turn, turn/completed says it once the turn is over.
      if (state.status === 'working' || state.status === 'starting') return { ...state, error: message };
      return withNotice(state, { id: `notice-error-${now}`, tone: 'error', text: message }, now);
    }

    case 'warning': {
      const message = str(params.message)?.trim();
      if (!message) return state;
      if (/code.mode host/i.test(message)) {
        return withNotice(state, { id: 'notice-no-runner', tone: 'error', text: CODEX_NO_RUNNER_NOTICE }, now);
      }
      return withNotice(state, { id: `notice-warning-${clip(message, 80)}`, tone: 'warning', text: clip(message, 400) }, now);
    }

    case 'model/rerouted': {
      const to = str(params.toModel);
      if (!to) return state;
      return withNotice(
        { ...state, model: to },
        { id: `notice-reroute-${str(params.turnId) ?? now}`, tone: 'info', text: `Codex moved this turn to ${to}` },
        now
      );
    }

    case 'thread/compacted':
      return compacted(state, str(params.turnId) ?? String(now), now);

    case 'turn/completed': {
      const turn = isObject(params.turn) ? params.turn : {};
      const status = str(turn.status);
      // Anything still spinning belongs to a turn that is over now.
      const items = state.items.map((item) =>
        item.kind === 'tool' && item.status === 'running' ? { ...item, status: 'done' as const, endedAt: now } : item
      );
      let next: AgentSessionState = {
        ...state,
        items,
        status: state.status === 'working' || state.status === 'starting' ? 'ready' : state.status,
        turnStartedAt: null,
        error: null,
        lastTurn: {
          durationMs: num(turn.durationMs) ?? (state.turnStartedAt ? now - state.turnStartedAt : 0),
          turns: 0,
          costUsd: null,
        },
      };
      const turnId = str(turn.id) ?? String(now);
      if (status === 'interrupted') {
        next = withNotice(next, { id: `notice-stopped-${turnId}`, tone: 'info', text: 'Stopped' }, now);
      } else if (status === 'failed') {
        const text = describeCodexError(turn.error) ?? state.error ?? 'Codex stopped with an error';
        next = withNotice(next, { id: `notice-failed-${turnId}`, tone: 'error', text }, now);
      }
      return next;
    }

    default:
      return state;
  }
}

/** Codex refused to start the turn (turn/start failed), so it is over before it began. */
export function failCodexTurn(state: AgentSessionState, message: string, now: number): AgentSessionState {
  const text = looksSignedOutCodex(message) ? CODEX_SIGN_IN_MESSAGE : message;
  return withNotice(
    { ...state, status: state.status === 'working' || state.status === 'starting' ? 'ready' : state.status, turnStartedAt: null },
    { id: `notice-turn-failed-${now}`, tone: 'error', text },
    now
  );
}
