// One prompt and its answer through the Claude Code or Codex CLI the user is
// signed in to, on their own plan (abs_claude_prompt and abs_codex_prompt in
// src-tauri). For writing jobs that need a model and nothing else, such as the
// Growth window's review replies and report summaries: the CLI starts with no
// tools and no MCP server, answers once and exits, and no conversation is
// kept. Any editor window can ask, a torn-off tab too.
//
// Desktop only. Import safe on the web, where every call rejects without
// importing anything from Tauri.

import { isTauri } from '@/lib/desktop';
import type { ClaudeDetection } from '@/lib/claudeCode/types';
import type { CodexDetection } from '@/lib/codex/types';

export type AgentWriter = 'claude' | 'codex';

export interface AgentWriterStatus {
  /** Installed, signed in and able to answer. */
  ready: boolean;
  /** The CLI and the plan it bills, such as "Claude Code (Max plan)". */
  label: string;
  /** Why it cannot answer, when it cannot. */
  detail?: string;
}

export type AgentWriters = Record<AgentWriter, AgentWriterStatus>;

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error('Claude Code and Codex answer in the desktop app only');
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  try {
    return await tauriInvoke<T>(command, args);
  } catch (error) {
    // Tauri rejects with the command's Err string, not an Error.
    throw error instanceof Error ? error : new Error(String(error));
  }
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

// Where the Agent panel keeps its choices (src/lib/claudeCode/store.ts), and
// the values it accepts there.
const CLAUDE_MODEL_KEY = 'osg-claude-agent-model';
const CODEX_MODEL_KEY = 'osg-codex-agent-model';
const CODEX_EFFORT_KEY = 'osg-codex-agent-effort';
const CLAUDE_MODELS = ['fable', 'opus', 'sonnet', 'haiku'];
/** What Rust takes as a Codex model id (valid_model in codex.rs). */
const CODEX_MODEL_ID = /^[A-Za-z0-9_.][A-Za-z0-9_.-]{0,63}$/;
const CODEX_EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

export interface AgentChoices {
  claudeModel?: string;
  codexModel?: string;
  codexEffort?: string;
}

/**
 * The models the Agent panel's chats run on, and the Codex effort level
 * picked there. Each is unset while the panel is on its default, which leaves
 * the CLI's own.
 */
export function storedAgentChoices(): AgentChoices {
  const claudeModel = readStorage(CLAUDE_MODEL_KEY);
  const codexModel = readStorage(CODEX_MODEL_KEY);
  const codexEffort = readStorage(CODEX_EFFORT_KEY);
  return {
    claudeModel: claudeModel && CLAUDE_MODELS.includes(claudeModel) ? claudeModel : undefined,
    codexModel: codexModel && CODEX_MODEL_ID.test(codexModel) ? codexModel : undefined,
    codexEffort: codexEffort && CODEX_EFFORTS.includes(codexEffort) ? codexEffort : undefined,
  };
}

export interface AgentPromptRequest {
  agent: AgentWriter;
  /** Replaces Claude Code's own instructions; goes ahead of the prompt for Codex. */
  system: string;
  user: string;
  signal?: AbortSignal;
  /** A model other than the Agent panel's. */
  model?: string;
  /**
   * Codex only. Unset runs at the CLI's default effort rather than the Agent
   * panel's, which is chosen for design work (max unless changed) and would
   * have a short reply think for minutes.
   */
  effort?: string;
}

function stopped(): DOMException {
  return new DOMException('Stopped', 'AbortError');
}

/**
 * The answer, or an AbortError as soon as `signal` fires. Aborting also runs
 * `onStop`, which kills the CLI.
 */
function untilStopped<T>(work: Promise<T>, signal: AbortSignal | undefined, onStop: () => void): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      onStop();
      reject(stopped());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}

/**
 * Send one prompt to Claude Code or Codex and resolve with the answer text.
 * Aborting `signal` kills the CLI's process, and the slot it held is free for
 * the next prompt.
 */
export async function runAgentPrompt(request: AgentPromptRequest): Promise<string> {
  if (request.signal?.aborted) throw stopped();
  const choices = storedAgentChoices();
  // Rust takes the prompt and its Stop as two calls, matched by this id.
  const id = crypto.randomUUID();
  const answer =
    request.agent === 'claude'
      ? invoke<string>('abs_claude_prompt', {
          id,
          system: request.system,
          prompt: request.user,
          model: request.model ?? choices.claudeModel ?? null,
        })
      : invoke<string>('abs_codex_prompt', {
          id,
          system: request.system,
          prompt: request.user,
          model: request.model ?? choices.codexModel ?? null,
          effort: request.effort ?? null,
        });
  const stop = request.agent === 'claude' ? 'abs_claude_prompt_stop' : 'abs_codex_prompt_stop';
  return untilStopped(answer, request.signal, () => {
    invoke<void>(stop, { id }).catch((error) => console.error('Stopping the prompt failed', error));
  });
}

// The plan names the Agent panel shows (ClaudeCodeSetup.tsx, CodexSetup.tsx).
const CLAUDE_PLANS: Record<string, string> = { pro: 'Pro', max: 'Max', team: 'Team', enterprise: 'Enterprise' };
const CODEX_PLANS: Record<string, string> = {
  free: 'Free',
  go: 'Go',
  plus: 'Plus',
  pro: 'Pro',
  prolite: 'Pro Lite',
  promax: 'Pro Max',
  team: 'Team',
  business: 'Business',
  enterprise: 'Enterprise',
  edu: 'Edu',
};

/** Whether Claude Code can answer, from abs_claude_detect. */
export function claudeWriterStatus(detection: ClaudeDetection): AgentWriterStatus {
  const plan = detection.subscriptionType ? CLAUDE_PLANS[detection.subscriptionType] ?? detection.subscriptionType : null;
  const label = plan ? `Claude Code (${plan} plan)` : 'Claude Code';
  if (detection.unavailable === 'sandboxed') {
    return { ready: false, label, detail: 'Claude Code cannot run from the Mac App Store version of the app' };
  }
  if (!detection.found) return { ready: false, label, detail: 'Claude Code is not installed on this computer' };
  if (detection.error) return { ready: false, label, detail: `Claude Code did not start: ${detection.error}` };
  if (detection.loggedIn === false) {
    return { ready: false, label, detail: 'Claude Code is not signed in. Run claude in a terminal to sign in' };
  }
  return { ready: true, label };
}

/** Whether Codex can answer, from abs_codex_detect. */
export function codexWriterStatus(detection: CodexDetection): AgentWriterStatus {
  const plan = detection.planType ? CODEX_PLANS[detection.planType] ?? detection.planType : null;
  const label = plan ? `Codex (ChatGPT ${plan} plan)` : 'Codex';
  if (detection.unavailable === 'sandboxed') {
    return { ready: false, label, detail: 'Codex cannot run from the Mac App Store version of the app' };
  }
  if (!detection.found) return { ready: false, label, detail: 'Codex is not installed on this computer' };
  if (detection.loginStore === 'keyring') {
    return {
      ready: false,
      label,
      detail: 'Codex keeps your login in the keychain. Run codex login -c cli_auth_credentials_store=file in a terminal',
    };
  }
  if (detection.error) return { ready: false, label, detail: `Codex did not start: ${detection.error}` };
  if (detection.loggedIn === false) {
    return { ready: false, label, detail: 'Codex is not signed in. Run codex login in a terminal' };
  }
  return { ready: true, label };
}

function failedStatus(label: string, reason: unknown): AgentWriterStatus {
  return { ready: false, label, detail: reason instanceof Error ? reason.message : String(reason) };
}

let detecting: Promise<AgentWriters> | null = null;

/**
 * Which of the two CLIs can answer here. Every detect starts both CLIs, so
 * the first answer is kept and handed to every later call until one asks for
 * `refresh` (after the user installs or signs in, say).
 */
export function detectAgentWriters(options: { refresh?: boolean } = {}): Promise<AgentWriters> {
  if (!detecting || options.refresh) {
    detecting = Promise.allSettled([
      invoke<ClaudeDetection>('abs_claude_detect'),
      invoke<CodexDetection>('abs_codex_detect'),
    ]).then(([claude, codex]) => ({
      claude: claude.status === 'fulfilled' ? claudeWriterStatus(claude.value) : failedStatus('Claude Code', claude.reason),
      codex: codex.status === 'fulfilled' ? codexWriterStatus(codex.value) : failedStatus('Codex', codex.reason),
    }));
  }
  return detecting;
}
