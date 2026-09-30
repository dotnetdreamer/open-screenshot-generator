// Folds Claude Code's stream-json output into a conversation.
//
// Pure: a state and one parsed stdout line in, the next state out. No clock, no
// ids minted from randomness; `now` is passed in. That keeps it testable in
// node against recorded transcripts, and safe to replay.
//
// What a turn looks like on the wire (claude -p --output-format stream-json):
//   {"type":"system","subtype":"init","session_id":..,"model":..,"mcp_servers":[..]}
//   {"type":"assistant","message":{"id":..,"content":[{"type":"text",...}]},"uuid":..}
//   {"type":"assistant","message":{"content":[{"type":"tool_use","id":..,"name":..,"input":..}]}}
//   {"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":..,"content":[..]}]}}
//   ...
//   {"type":"result","subtype":"success","is_error":false,"result":..,"duration_ms":..}
// Each content block arrives as its own assistant message. `init` is repeated
// at the start of every turn.

import { toolDetail } from './toolLabels';
import type { AgentItem, AgentSessionState } from './types';

/** Longest tool answer kept in the transcript. The panel shows a line of it. */
const MAX_RESULT_CHARS = 1200;

/** A transcript longer than this drops its oldest items. */
export const MAX_ITEMS = 400;

/**
 * Tools from the app's own server arrive as mcp__<server>__<tool>. The server
 * name has hyphens and never a double underscore, so the first `__` after it
 * is the split.
 */
export function stripToolPrefix(name: string): string {
  const match = /^mcp__.+?__(.+)$/.exec(name);
  return match ? match[1] : name;
}

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

/** Text of a tool_result's content, which is either a string or content blocks. */
function toolResultText(content: unknown): { text: string; image?: string } {
  if (typeof content === 'string') return { text: content };
  if (!Array.isArray(content)) return { text: '' };
  const parts: string[] = [];
  let image: string | undefined;
  for (const block of content) {
    if (!isObject(block)) continue;
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
    if (block.type === 'image' && !image) {
      // Claude Code re-emits an MCP image either as an Anthropic image block
      // ({source:{type:'base64',media_type,data}}) or as the MCP shape
      // ({data,mimeType}). Rust empties the bytes of a large one.
      const source = isObject(block.source) ? block.source : null;
      const data = str(source?.data) ?? str(block.data);
      const mediaType = str(source?.media_type) ?? str(block.mimeType) ?? 'image/png';
      if (data) image = `data:${mediaType};base64,${data}`;
    }
  }
  return { text: parts.join('\n'), image };
}

function clip(text: string, max = MAX_RESULT_CHARS): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

const SIGN_IN_MESSAGE = 'Claude Code is not signed in. Run claude in a terminal, sign in, then send your message again';

/** Whether a message from Claude Code means its login is missing or expired. */
export function looksSignedOut(text: string): boolean {
  return /\/login|not logged in|invalid api key|oauth token has expired|please (run|sign in)|authenticat/i.test(text);
}

/** Turn a result subtype into something a person can act on. */
function describeResultError(msg: Json): string {
  const subtype = str(msg.subtype) ?? '';
  const result = str(msg.result)?.trim() ?? '';
  if (subtype === 'error_max_turns') return 'Claude Code stopped after too many steps. Ask it to carry on';
  if (subtype === 'error_max_budget_usd') return 'Claude Code reached its spending limit for this chat';
  const status = num(msg.api_error_status);
  if (status === 401 || status === 403 || looksSignedOut(result)) return SIGN_IN_MESSAGE;
  if (status === 429) return 'Your Claude plan hit its usage limit. Try again when it resets';
  const errors = Array.isArray(msg.errors) ? msg.errors.filter((e): e is string => typeof e === 'string' && !!e) : [];
  // "undefined" is what an aborted turn reports as its result.
  if (result && result !== 'undefined') return result;
  if (errors.length) return errors.join('; ');
  return 'Claude Code stopped with an error';
}

/** A turn the user stopped ends with a terminal reason like "aborted_streaming". */
function wasStopped(msg: Json): boolean {
  return /^abort|interrupt/i.test(str(msg.terminal_reason) ?? '');
}

/**
 * Apply one parsed stdout line. Anything unrecognised returns the state as it
 * was, which is what makes new message types from a newer Claude Code harmless.
 */
export function reduceStreamMessage(state: AgentSessionState, msg: unknown, now: number): AgentSessionState {
  if (!isObject(msg)) return state;
  const type = str(msg.type);

  if (type === 'system') {
    const subtype = str(msg.subtype);
    if (subtype === 'init') {
      const servers = Array.isArray(msg.mcp_servers) ? msg.mcp_servers.filter(isObject) : [];
      const ours = servers[0];
      const connected = ours ? str(ours.status) === 'connected' : false;
      const apiKeySource = str(msg.apiKeySource);
      const billedElsewhere = !!apiKeySource && apiKeySource !== 'none';
      const next: AgentSessionState = {
        ...state,
        sessionId: str(msg.session_id) ?? state.sessionId,
        model: str(msg.model) ?? state.model,
        toolsConnected: connected,
        billedToApiKey: billedElsewhere,
      };
      const notices: AgentItem[] = [];
      // Each said once per conversation, not on every turn's init.
      if (!connected && state.toolsConnected !== false) {
        notices.push({
          kind: 'notice',
          id: `notice-tools-${str(msg.uuid) ?? now}`,
          tone: 'error',
          text: 'Claude Code could not reach the design tools, so it cannot change the canvas. Start a new chat to try again',
          at: now,
        });
      }
      if (billedElsewhere && !state.billedToApiKey) {
        notices.push({
          kind: 'notice',
          id: `notice-billing-${str(msg.uuid) ?? now}`,
          tone: 'warning',
          text: `This chat is billed to an API key (${apiKeySource}), not your Claude plan`,
          at: now,
        });
      }
      if (notices.length) next.items = trimItems([...state.items, ...notices]);
      return next;
    }
    if (subtype === 'api_retry') {
      const attempt = num(msg.attempt);
      return {
        ...state,
        items: trimItems([
          ...state.items,
          {
            kind: 'notice',
            id: `notice-retry-${str(msg.uuid) ?? now}`,
            tone: 'info',
            text: attempt ? `Claude is busy, retrying (attempt ${attempt})` : 'Claude is busy, retrying',
            at: now,
          },
        ]),
      };
    }
    return state;
  }

  if (type === 'rate_limit_event') {
    const info = isObject(msg.rate_limit_info) ? msg.rate_limit_info : null;
    if (!info) return state;
    return {
      ...state,
      rateLimit: {
        status: str(info.status) ?? 'allowed',
        resetsAt: num(info.resetsAt),
        type: str(info.rateLimitType),
      },
    };
  }

  if (type === 'assistant') {
    // A sub-agent's messages carry the parent tool call's id. The agent has no
    // tool that starts one, so anything here is noise.
    if (msg.parent_tool_use_id) return state;
    const message = isObject(msg.message) ? msg.message : null;
    const content = Array.isArray(message?.content) ? message.content : [];
    const uuid = str(msg.uuid) ?? `${str(message?.id) ?? 'msg'}-${now}`;
    let items = state.items;
    content.forEach((block, index) => {
      if (!isObject(block)) return;
      const id = content.length > 1 ? `${uuid}-${index}` : uuid;
      if (block.type === 'text') {
        const text = str(block.text)?.trim();
        if (!text) return;
        if (items.some((item) => item.id === id)) return;
        items = [...items, { kind: 'text', id, text, at: now }];
      } else if (block.type === 'tool_use') {
        const toolUseId = str(block.id) ?? id;
        if (items.some((item) => item.kind === 'tool' && item.toolUseId === toolUseId)) return;
        const name = stripToolPrefix(str(block.name) ?? 'tool');
        const input = isObject(block.input) ? block.input : {};
        items = [
          ...items,
          {
            kind: 'tool',
            id,
            toolUseId,
            name,
            input,
            detail: toolDetail(name, input) ?? undefined,
            status: 'running',
            at: now,
          },
        ];
      }
    });
    if (items === state.items) return state;
    return { ...state, items: trimItems(items) };
  }

  if (type === 'user') {
    if (msg.parent_tool_use_id) return state;
    const message = isObject(msg.message) ? msg.message : null;
    const content = Array.isArray(message?.content) ? message.content : [];
    let changed = false;
    const items = state.items.map((item) => {
      if (item.kind !== 'tool') return item;
      const block = content.find(
        (entry): entry is Json => isObject(entry) && entry.type === 'tool_result' && entry.tool_use_id === item.toolUseId
      );
      if (!block) return item;
      changed = true;
      const { text, image } = toolResultText(block.content);
      return {
        ...item,
        status: block.is_error ? ('error' as const) : ('done' as const),
        result: clip(text.trim()),
        image,
        endedAt: now,
      };
    });
    return changed ? { ...state, items } : state;
  }

  if (type === 'result') {
    // Anything still spinning belongs to a turn that is over now, whatever
    // happened to its tool_result (a reload in the middle loses events).
    const items = state.items.map((item) =>
      item.kind === 'tool' && item.status === 'running' ? { ...item, status: 'done' as const, endedAt: now } : item
    );
    const stopped = wasStopped(msg);
    const isError = !stopped && (msg.is_error === true || (str(msg.subtype) ?? 'success') !== 'success');
    const next: AgentSessionState = {
      ...state,
      status: state.status === 'working' || state.status === 'starting' ? 'ready' : state.status,
      sessionId: str(msg.session_id) ?? state.sessionId,
      turnStartedAt: null,
      lastTurn: {
        durationMs: num(msg.duration_ms) ?? (state.turnStartedAt ? now - state.turnStartedAt : 0),
        turns: num(msg.num_turns) ?? 0,
        costUsd: num(msg.total_cost_usd),
      },
      items,
    };
    if (stopped) {
      next.items = trimItems([
        ...items,
        { kind: 'notice', id: `notice-stopped-${str(msg.uuid) ?? now}`, tone: 'info', text: 'Stopped', at: now },
      ]);
    } else if (isError) {
      next.items = trimItems([
        ...items,
        { kind: 'notice', id: `notice-result-${str(msg.uuid) ?? now}`, tone: 'error', text: describeResultError(msg), at: now },
      ]);
    }
    return next;
  }

  return state;
}

/** Why a process that died in the middle of a turn died, for the transcript. */
export function describeExit(code: number | null, stderrTail: string[]): string {
  const tail = stderrTail.map((line) => line.trim()).filter(Boolean);
  const joined = tail.join('\n');
  if (looksSignedOut(joined)) return SIGN_IN_MESSAGE;
  const last = [...tail].reverse().find((line) => !/^\s*at\s/.test(line));
  if (last) return `Claude Code stopped: ${last.length > 300 ? `${last.slice(0, 300)}…` : last}`;
  return code === null ? 'Claude Code stopped' : `Claude Code stopped (exit code ${code})`;
}

/** Parse one stdout line and fold it in. A line that is not JSON is ignored. */
export function reduceStreamLine(state: AgentSessionState, line: string, now: number): AgentSessionState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return state;
  }
  return reduceStreamMessage(state, parsed, now);
}

/** The user's side of a turn, added the moment it is sent. */
export function appendUserTurn(
  state: AgentSessionState,
  turn: { id: string; text: string; attachments: number },
  now: number
): AgentSessionState {
  return {
    ...state,
    status: 'working',
    error: null,
    turnStartedAt: now,
    items: trimItems([...state.items, { kind: 'user', id: turn.id, text: turn.text, attachments: turn.attachments, at: now }]),
  };
}

export function appendNotice(
  state: AgentSessionState,
  notice: { id: string; tone: 'info' | 'warning' | 'error'; text: string },
  now: number
): AgentSessionState {
  return { ...state, items: trimItems([...state.items, { kind: 'notice', ...notice, at: now }]) };
}

/**
 * The process is gone. A turn it was in the middle of is over, and anything
 * still marked running never finished.
 */
export function markExited(state: AgentSessionState, now: number): AgentSessionState {
  const items = state.items.map((item) =>
    item.kind === 'tool' && item.status === 'running' ? { ...item, status: 'error' as const, endedAt: now } : item
  );
  return { ...state, status: state.status === 'idle' ? 'idle' : 'stopped', turnStartedAt: null, items };
}
