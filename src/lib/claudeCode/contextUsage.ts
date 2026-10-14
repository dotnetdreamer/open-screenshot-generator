// How full the agent's context window is, read from the token counts in
// Claude Code's stream-json output, and how the Agent panel's ring shows it.
//
// What the stream says, measured on Claude Code 2.1.285:
// - Every assistant line carries its model call's `usage`. The prompt side
//   (input_tokens + cache_creation_input_tokens + cache_read_input_tokens) is
//   final there; output_tokens is the count when the line was printed, a few.
// - The `result` that ends a turn adds up every call of the turn in `usage`,
//   so that total is not the size of anything. `usage.iterations` holds the
//   turn's last call on its own, with its final output_tokens.
// - `modelUsage[model].contextWindow` is the model's window, and it varies:
//   1M for Opus 5.5, Sonnet 5.5 and Fable 5.1, 200k for Haiku 4.5. Only a
//   `result` carries it.
// - The next call's prompt carries the last call's whole output, thinking
//   included, on Opus 5.5 and Haiku 4.5 alike: an Opus turn that wrote 1145
//   tokens, 1141 of them thinking, grew the next prompt by 1145 plus the new
//   message. Claude Code's own /context adds only a rough count of the reply's
//   text to the last prompt, so right after a long think it reads lower than
//   what the next call carries.
// - /context, /compact and API errors print `<synthetic>` assistant lines with
//   zero usage, and an interrupted turn's result has no iterations and no
//   modelUsage. Neither says anything about the context.
// - The control request `get_context_usage` is answered at once, before the
//   first message too, without adding anything to the conversation. Its
//   answer holds the window (`rawMaxTokens`), the model, the last call's
//   usage (`apiUsage`, null before the first call and after a summary) and
//   Claude Code's own estimate (`totalTokens`). Resuming a conversation brings
//   back the last call's usage, so a reopened chat is exact from the start.

import type { AgentContextUsage } from './types';

/** How the request id of a context question starts, so the reducer knows its answer. */
export const CONTEXT_REQUEST_PREFIX = 'context-';

/** The first Claude Code `get_context_usage` was checked on. */
const CONTEXT_QUESTIONS_SINCE = [2, 1, 285];

/**
 * Whether this Claude Code ("2.1.285 (Claude Code)") is one known to answer a
 * context question. What an older one does with a request it does not know
 * is untested, so it is not asked, and its ring waits for a turn to end.
 */
export function answersContextQuestions(version: string | null | undefined): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version?.trim() ?? '');
  if (!match) return false;
  const parts = match.slice(1).map(Number);
  for (let index = 0; index < CONTEXT_QUESTIONS_SINCE.length; index++) {
    if (parts[index] !== CONTEXT_QUESTIONS_SINCE[index]) return parts[index] > CONTEXT_QUESTIONS_SINCE[index];
  }
  return true;
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function tokens(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

/**
 * The tokens one model call leaves in the context: its whole prompt plus its
 * output. Null for a usage with no prompt, which is what a synthetic line
 * reports.
 */
export function usageTokens(usage: unknown): number | null {
  if (!isObject(usage)) return null;
  const prompt = tokens(usage.input_tokens) + tokens(usage.cache_creation_input_tokens) + tokens(usage.cache_read_input_tokens);
  return prompt > 0 ? prompt + tokens(usage.output_tokens) : null;
}

/** The turn's last model call, with its final output, from the `usage` of the turn's `result`. */
export function lastCallTokens(resultUsage: unknown): number | null {
  if (!isObject(resultUsage) || !Array.isArray(resultUsage.iterations)) return null;
  return usageTokens(resultUsage.iterations[resultUsage.iterations.length - 1]);
}

/**
 * The window `result.modelUsage` gives for `model`. A process can call more
 * than one model, so the entry is picked by name. When the name is not there,
 * a lone entry can only be the model that answered.
 */
export function contextWindowOf(modelUsage: unknown, model: string | null): number | null {
  if (!isObject(modelUsage)) return null;
  const entries = Object.values(modelUsage);
  const entry =
    model && Object.prototype.hasOwnProperty.call(modelUsage, model)
      ? modelUsage[model]
      : entries.length === 1
        ? entries[0]
        : null;
  return isObject(entry) ? positive(entry.contextWindow) : null;
}

/**
 * The reading after Claude Code answered a context question. Its window and
 * model are taken as they are. Its count fills in only a reading without one
 * (a new process, just after a summary, or another model): the stream's
 * per-call numbers are newer than an answer that crossed them on the way.
 * `apiUsage` is the last call with its final output, the stream's own sum;
 * before the first call and after a summary it is null, and `totalTokens`,
 * Claude Code's estimate, stands in.
 */
export function reportedContext(context: AgentContextUsage | null, report: unknown): AgentContextUsage | null {
  if (!isObject(report)) return context;
  const model = typeof report.model === 'string' && report.model ? report.model : (context?.model ?? null);
  const window = positive(report.rawMaxTokens) ?? positive(report.maxTokens) ?? context?.window ?? null;
  const kept = context && context.model === model ? context.used : null;
  const used = kept ?? usageTokens(report.apiUsage) ?? positive(report.totalTokens) ?? null;
  if (used === null && window === null) return context;
  if (context?.used === used && context.window === window && context.model === model) return context;
  return { used, window, model };
}

/** A saved reading, or null when storage holds nothing usable. */
export function sanitizeContextUsage(value: unknown): AgentContextUsage | null {
  if (!isObject(value)) return null;
  const used = positive(value.used);
  const window = positive(value.window);
  if (used === null && window === null) return null;
  return { used, window, model: typeof value.model === 'string' && value.model ? value.model : null };
}

/** Models whose window is remembered. The newest stay. */
const MAX_WINDOWS = 20;

/** The windows learned from earlier turns, by model id, as storage held them. */
export function sanitizeContextWindows(value: unknown): Record<string, number> {
  const windows: Record<string, number> = {};
  if (!isObject(value)) return windows;
  for (const [model, window] of Object.entries(value).slice(-MAX_WINDOWS)) {
    const size = positive(window);
    if (model && size !== null) windows[model] = size;
  }
  return windows;
}

/**
 * `windows` plus the window `context` reports for its model, or `windows`
 * itself when that adds nothing. A new chat starts on a model whose window an
 * earlier turn taught, so its ring shows from the first call.
 */
export function learnContextWindow(
  windows: Record<string, number>,
  context: AgentContextUsage | null
): Record<string, number> {
  const model = context?.model;
  const window = context?.window;
  if (!model || !window || windows[model] === window) return windows;
  const rest = Object.entries(windows).filter(([key]) => key !== model);
  return Object.fromEntries([...rest, [model, window]].slice(-MAX_WINDOWS));
}

/** 842, 10.6k, 200k, 1M: one decimal at most, as Claude Code's /context writes them. */
export function formatTokens(count: number): string {
  const short = (value: number) => value.toFixed(1).replace(/\.0$/, '');
  if (count >= 999_950) return `${short(count / 1_000_000)}M`;
  if (count >= 1000) return `${short(count / 1000)}k`;
  return String(Math.round(count));
}

/** Where the ring turns amber, then red. Claude Code summarizes before the window is full. */
const HIGH = 0.75;
const FULL = 0.9;

export interface ContextMeter {
  /** The share of the window used, 0 to 1. 0 while the window or the count is unknown. */
  fraction: number;
  /** Whole percent, for screen readers. 0 while unknown. */
  percent: number;
  /**
   * What the ring's label says: "5%", or "<1%" so a started chat never reads
   * as empty, the token count while the window is unknown, "0%" in a chat
   * with nothing in it yet, and nothing while there is no count at all.
   */
  label: string;
  /** "5% of the context window used (10.6k of 200k tokens)", for the tooltip and screen readers. */
  description: string;
  level: 'normal' | 'high' | 'full';
}

/**
 * What the ring shows. It always shows something: `empty` is a chat with no
 * message and no conversation yet, where nothing is in the window. `agentName`
 * is the CLI that reports the counts, named when it has not yet.
 */
export function contextMeter(
  context: AgentContextUsage | null,
  { empty = false, agentName = 'Claude Code' }: { empty?: boolean; agentName?: string } = {}
): ContextMeter {
  const used = context?.used ?? null;
  const window = context?.window ?? null;
  if (used !== null && window !== null) {
    const fraction = Math.min(1, used / window);
    // 99.6% is not full, so only a context at or past the window reads 100%.
    const percent = fraction >= 1 ? 100 : Math.min(99, Math.round(fraction * 100));
    const sliver = percent === 0;
    return {
      fraction,
      percent,
      label: sliver ? '<1%' : `${percent}%`,
      description: `${sliver ? 'Less than 1%' : `${percent}%`} of the context window used (${formatTokens(used)} of ${formatTokens(window)} tokens)`,
      level: fraction >= FULL ? 'full' : fraction >= HIGH ? 'high' : 'normal',
    };
  }
  const unknown = { fraction: 0, percent: 0, level: 'normal' as const };
  if (used !== null) {
    return {
      ...unknown,
      label: formatTokens(used),
      description: `${formatTokens(used)} tokens in the context window. ${agentName} has not reported the window size yet`,
    };
  }
  if (empty) return { ...unknown, label: '0%', description: 'Nothing in the context window yet' };
  return { ...unknown, label: '', description: `${agentName} has not reported the context window yet` };
}
