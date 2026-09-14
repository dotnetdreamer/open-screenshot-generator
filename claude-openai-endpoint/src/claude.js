// The half that talks to Claude.
//
// One HTTP request in, one `query()` out. The Agent SDK spawns the Claude Code
// CLI, the CLI signs the call with the subscription this machine is already
// logged in to, and the answer comes back as text or as a validated object.
// Nothing here reads or writes a file, runs a tool, or keeps a session: a
// completions endpoint has no use for any of that, and turning it all off is
// what makes the CLI behave like a plain model rather than like an agent.
//
// The environment is scrubbed rather than replaced. `env` hands the child its
// whole environment, so building one from scratch would cost it PATH and HOME
// and with them its route to the login in the Keychain. What gets deleted is
// every variable that would send the call somewhere other than the
// subscription: ANTHROPIC_API_KEY alone silently moves the bill to API credit,
// and in non-interactive mode the CLI takes it without asking.

import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';

/**
 * An empty directory to run every completion in.
 *
 * The CLI writes an environment preamble into each turn holding the working
 * directory, whether it is a git repo, and the contents of the auto-memory kept
 * for that directory. Started from a checkout, that means somebody's private
 * notes about their project ride along with a request to write three App Store
 * headlines: not a leak to a stranger, since it is the caller's own account,
 * but nothing anybody asked for and a few thousand tokens on every call.
 *
 * `settingSources: []` does not cover it, and `excludeDynamicSections` works
 * only with the preset system prompt, not the custom one a completions endpoint
 * needs. An empty scratch directory does: no memory file exists for it, and the
 * path it names says nothing. What still reaches the model is the platform, the
 * date and the account's email address, which the CLI supplies with no option
 * to withhold.
 */
const SANDBOX = path.join(os.tmpdir(), 'claude-openai-endpoint-cwd');
mkdirSync(SANDBOX, { recursive: true });

/**
 * Variables that reroute or re-bill the call. Deleting them is the whole of
 * "use my subscription": with none of these set the CLI falls back to the
 * OAuth login it stores in the Keychain, which is the Max plan.
 *
 * CLAUDE_CODE_OAUTH_TOKEN is deliberately left alone. It is the one override
 * that forces OAuth rather than away from it, so someone who has set it meant
 * to.
 */
const REROUTING_VARS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
  'ANTHROPIC_FOUNDRY_API_KEY',
  'ANTHROPIC_FOUNDRY_AUTH_TOKEN',
  'ANTHROPIC_AWS_API_KEY',
  'AWS_BEARER_TOKEN_BEDROCK',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_ANTHROPIC_AWS',
  'CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD',
  'CLAUDE_CODE_USE_MANTLE',
  'CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR',
];

export function subscriptionEnv() {
  const env = { ...process.env };
  for (const name of REROUTING_VARS) delete env[name];
  // Set by whatever Claude Code session may have started this server. Left in
  // place the child thinks it is nested inside another run.
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  return env;
}

/**
 * Tools are off two ways because the two knobs do different things.
 * `tools: []` is the restriction ("use nothing"), and it is the one that
 * matters; `disallowedTools` is belt and braces for a CLI that grows a tool
 * outside the built-in set. `allowedTools: []` looks like it belongs here and
 * does nothing at all: it is an auto-approve list, and an empty one is dropped
 * before the flag is built.
 *
 * `settingSources: []` is the only thing that stops the user's own
 * settings.json, CLAUDE.md and apiKeyHelper from loading. Without it a
 * completion would be shaped by whatever project the server happens to sit in.
 */
const OFF = {
  cwd: SANDBOX,
  tools: [],
  disallowedTools: [
    'Bash',
    'Read',
    'Write',
    'Edit',
    'NotebookEdit',
    'Glob',
    'Grep',
    'WebFetch',
    'WebSearch',
    'Task',
    'Skill',
    'TodoWrite',
  ],
  settingSources: [],
  mcpServers: {},
  strictMcpConfig: true,
  plugins: [],
  // 'dontAsk' denies anything that slips through. 'bypassPermissions' would
  // allow it, and needs a second opt-in flag to work at all.
  permissionMode: 'dontAsk',
  persistSession: false,
  includePartialMessages: false,
};

export class ClaudeError extends Error {
  constructor(message, status = 502, code = 'upstream_error') {
    super(message);
    this.name = 'ClaudeError';
    this.status = status;
    this.code = code;
  }
}

/**
 * A CLI run reduced to what a completion needs.
 *
 * `content` is the blocks of the single user turn, `system` the system prompt,
 * `schema` an optional JSON Schema the reply must satisfy. `onText` is called
 * with each fragment as it arrives and is what streaming is built on; leaving
 * it out costs nothing but the partial messages.
 *
 * Returns { text, object, usage, costUsd, model, stopReason }. `object` is set
 * only when a schema was asked for and the CLI produced one.
 */
export async function runClaude({
  model,
  system,
  content,
  schema,
  maxTurns = 1,
  signal,
  onText,
  onStderr,
}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal) {
    if (signal.aborted) throw new ClaudeError('The client went away.', 499, 'client_closed');
    signal.addEventListener('abort', abort);
  }

  const options = {
    ...OFF,
    env: subscriptionEnv(),
    maxTurns,
    abortController: controller,
    // Omitting this sends an empty system prompt rather than Claude Code's own,
    // which is what a completions endpoint wants: the caller's system message
    // is the only instruction in the room.
    systemPrompt: system || '',
    // Thinking is off because a completion is judged on its output, and an
    // adaptive budget makes latency swing by tens of seconds between two
    // identical requests.
    thinking: { type: 'disabled' },
    includePartialMessages: Boolean(onText),
    stderr: onStderr,
  };
  if (model) options.model = model;
  if (schema) options.outputFormat = { type: 'json_schema', schema };

  // An async iterable rather than a string, because a string prompt is wrapped
  // in a lone text block and an image can never ride along in one. The
  // generator returning after its single yield is what closes the child's
  // stdin; a `return` in the finally below covers the streaming path, where the
  // loop is left early.
  async function* turn() {
    yield {
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null,
      // Blank on purpose. Each run is its own session, and a stale id makes the
      // CLI drop the message with no error anywhere.
      session_id: '',
    };
  }

  const q = query({ prompt: turn(), options });

  let text = '';
  let stopReason = 'stop';
  let result = null;
  let resolvedModel = '';

  try {
    for await (const message of q) {
      if (message.type === 'system' && message.subtype === 'init') {
        // The only place the model the CLI actually resolved is stated. The
        // result message names every model that billed anything, which on a
        // normal run includes a small helper the CLI uses for itself.
        resolvedModel = message.model || '';
        warnIfNotSubscription(message.apiKeySource);
        continue;
      }
      if (message.type === 'stream_event') {
        const event = message.event;
        if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          const piece = event.delta.text ?? '';
          if (piece) {
            text += piece;
            onText?.(piece);
          }
        }
        continue;
      }
      if (message.type === 'assistant' && !onText) {
        for (const block of message.message?.content ?? []) {
          if (block.type === 'text') text += block.text ?? '';
        }
        continue;
      }
      if (message.type === 'result') {
        result = message;
        break;
      }
    }
  } finally {
    if (signal) signal.removeEventListener('abort', abort);
    // Breaking out of the loop above leaves the child running. close() is the
    // documented way to end it; older SDKs only have the generator's return.
    try {
      await q.close?.();
    } catch {
      // Already gone. Nothing left to close.
    }
  }

  if (controller.signal.aborted) {
    throw new ClaudeError('The client went away.', 499, 'client_closed');
  }
  if (!result) {
    throw new ClaudeError('The Claude CLI ended without answering.', 502, 'no_result');
  }
  if (result.subtype !== 'success') {
    throw new ClaudeError(describeFailure(result), statusForFailure(result), result.subtype);
  }

  // A refused model is reported as a SUCCESS whose text is an apology about the
  // model, with `is_error` set and nothing in `modelUsage`. Passing that on as a
  // 200 is the worst outcome available: the caller gets prose where it expected
  // an answer and no status to branch on. `modelUsage` being empty is what says
  // no model ran at all, which makes it the model id that was wrong.
  if (result.is_error === true) {
    const nothingRan = !result.modelUsage || Object.keys(result.modelUsage).length === 0;
    throw new ClaudeError(
      typeof result.result === 'string' && result.result ? result.result : 'The Claude CLI reported an error.',
      nothingRan ? 404 : 502,
      nothingRan ? 'model_not_found' : 'upstream_error'
    );
  }

  // `result` is the final text and is authoritative. The streamed pieces can
  // miss a block the CLI rewrote before finishing.
  if (typeof result.result === 'string' && result.result.length >= text.length) {
    text = result.result;
  }

  return {
    text,
    object: result.structured_output ?? null,
    usage: normalizeUsage(result.usage),
    costUsd: typeof result.total_cost_usd === 'number' ? result.total_cost_usd : 0,
    model: resolvedModel || model || '',
    stopReason: result.stop_reason || stopReason,
    sessionId: result.session_id || '',
  };
}

function describeFailure(result) {
  const errors = Array.isArray(result.errors) ? result.errors.filter(Boolean) : [];
  if (errors.length) return errors.join('; ');
  switch (result.subtype) {
    case 'error_max_turns':
      return 'Claude stopped after its turn limit without finishing.';
    case 'error_max_budget_usd':
      return 'The run hit its cost ceiling.';
    case 'error_max_structured_output_retries':
      return 'Claude could not produce output matching the requested JSON schema.';
    default:
      return 'The Claude CLI reported an error.';
  }
}

/**
 * A schema Claude could not satisfy is the caller's problem to fix, so it is a
 * 400 and not a 502. That distinction is load bearing for the editor: its
 * design agent treats a 400 as "this endpoint dislikes json_schema" and asks
 * again in prose, which is exactly the right next move.
 */
function statusForFailure(result) {
  return result.subtype === 'error_max_structured_output_retries' ? 400 : 502;
}

/**
 * Says so, once, if the call is not being signed by the subscription.
 *
 * `apiKeySource` is 'none' when the CLI used the OAuth login in the Keychain,
 * which is the whole point of this server. Anything else means a key reached
 * the child despite the scrubbing above and the run is on API credit. That is
 * a billing surprise, not an error, so it is a warning and the run continues.
 */
let warnedAboutAuth = false;

function warnIfNotSubscription(apiKeySource) {
  if (warnedAboutAuth || !apiKeySource || apiKeySource === 'none') return;
  warnedAboutAuth = true;
  process.stderr.write(
    `[claude-endpoint] warning: this run was authenticated by "${apiKeySource}", not the ` +
      'subscription login. Something in the environment is supplying a key, and these calls ' +
      'are billed as API usage.\n'
  );
}

/**
 * Cache reads and writes are input tokens that were billed differently, not a
 * separate budget, so they are folded into prompt_tokens. A caller comparing
 * this against another endpoint's numbers gets something comparable.
 */
function normalizeUsage(usage) {
  const input = Number(usage?.input_tokens ?? 0);
  const cacheRead = Number(usage?.cache_read_input_tokens ?? 0);
  const cacheWrite = Number(usage?.cache_creation_input_tokens ?? 0);
  const output = Number(usage?.output_tokens ?? 0);
  const prompt = input + cacheRead + cacheWrite;
  return {
    prompt_tokens: prompt,
    completion_tokens: output,
    total_tokens: prompt + output,
    prompt_tokens_details: { cached_tokens: cacheRead },
  };
}
