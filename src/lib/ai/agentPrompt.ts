// One prompt and its answer through the Claude Code or Codex CLI the user is
// signed in to, on that sign-in (abs_claude_prompt and abs_codex_prompt in
// src-tauri). For writing jobs that need a model and nothing else, such as the
// Growth window's review replies and report summaries, and the translations
// of the text on the artboards: the CLI starts with no tools and no MCP
// server, answers once and exits, and no conversation is kept. Any editor
// window can ask, a torn-off tab too.
//
// Rust runs at most three prompts per CLI at once and refuses a fourth. A
// translation sends several at a time while Growth may be writing a summary,
// so prompts from this window wait for a free slot here, and one refused
// because another window holds the slots waits and asks again.
//
// Ask AI in the Store compliance view can also let Claude Code read the
// user's app code: the prompt names the folder's path, one the user picked in
// Rust's dialog for this (pickPromptFolder), and Claude Code opens the files
// it needs with Read and Grep. The page never reads or sends the files.
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
  /** It can never run in this build: the Mac App Store's sandbox. */
  sandboxed?: boolean;
}

export type AgentWriters = Record<AgentWriter, AgentWriterStatus>;

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error('Claude Code and Codex work in the desktop app only');
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
  /**
   * Claude Code only: paths of code folders it may read, each picked with
   * pickPromptFolder. Codex reads no code folder, so a Codex prompt with one
   * is refused rather than answered without it.
   */
  folders?: string[];
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
    // A signal that has already fired never fires again for a new listener.
    if (signal.aborted) {
      onAbort();
      return;
    }
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

/** How many prompts Rust runs at once for one CLI (MAX_PROMPTS in claude_code.rs). */
export const AGENT_PROMPTS_AT_ONCE = 3;

/** How long a prompt refused for want of a slot waits before it asks again, and how often. */
const BUSY_PAUSE_MS = 1500;
const BUSY_ATTEMPTS = 40;

const running: Record<AgentWriter, number> = { claude: 0, codex: 0 };
const waiting: Record<AgentWriter, Array<() => void>> = { claude: [], codex: [] };

/**
 * One of the CLI's slots for this window, waiting while all of them are in
 * use. Resolves with the function that gives it back.
 */
function takeSlot(agent: AgentWriter, signal?: AbortSignal): Promise<() => void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(stopped());
      return;
    }
    const grant = () => {
      running[agent]++;
      let given = false;
      resolve(() => {
        if (given) return;
        given = true;
        running[agent]--;
        waiting[agent].shift()?.();
      });
    };
    if (running[agent] < AGENT_PROMPTS_AT_ONCE) {
      grant();
      return;
    }
    const onAbort = () => {
      const at = waiting[agent].indexOf(next);
      if (at >= 0) waiting[agent].splice(at, 1);
      reject(stopped());
    };
    const next = () => {
      signal?.removeEventListener('abort', onAbort);
      grant();
    };
    waiting[agent].push(next);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * True for Rust's answer when all of a CLI's slots are taken (PROMPT_BUSY in
 * claude_code.rs and codex.rs). Another window holds them, or a stopped
 * prompt's process has not ended yet.
 */
function isBusy(error: unknown): boolean {
  return error instanceof Error && /is still answering/.test(error.message);
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(stopped());
    const onAbort = () => {
      clearTimeout(timer);
      reject(stopped());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Send one prompt to Claude Code or Codex and resolve with the answer text.
 * Aborting `signal` kills the CLI's process, and the slot it held is free for
 * the next prompt.
 */
export async function runAgentPrompt(request: AgentPromptRequest): Promise<string> {
  if (request.signal?.aborted) throw stopped();
  const release = await takeSlot(request.agent, request.signal);
  try {
    for (let attempt = 1; ; attempt++) {
      try {
        return await promptOnce(request);
      } catch (error) {
        if (request.signal?.aborted || !isBusy(error) || attempt >= BUSY_ATTEMPTS) throw error;
        await pause(BUSY_PAUSE_MS, request.signal);
      }
    }
  } finally {
    release();
  }
}

async function promptOnce(request: AgentPromptRequest): Promise<string> {
  // The slot can be granted, or the busy pause end, in the same moment as a
  // Stop: nothing may start after it.
  if (request.signal?.aborted) throw stopped();
  const folders = request.folders?.length ? request.folders : null;
  if (folders && request.agent !== 'claude') throw new Error(ONLY_CLAUDE_READS_CODE);
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
          folders,
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

/** Why a prompt that would read code cannot: only Claude Code reads a code folder here. */
export const ONLY_CLAUDE_READS_CODE = 'Only Claude Code can read your code. Pick Claude Code, or take the folder off';

export type PromptFolderPick = { kind: 'picked'; folder: { name: string; path: string } } | { kind: 'cancelled' } | { kind: 'refused'; message: string };

/**
 * Rust's folder dialog, for a folder one-shot prompts may read. It goes on a
 * list of its own (PROMPT_BOOK in claude_code.rs), apart from the Agent
 * chats' folders, so neither can take a folder away from the other.
 */
export async function pickPromptFolder(): Promise<PromptFolderPick> {
  try {
    const folder = await invoke<{ name: string; path: string } | null>('abs_claude_pick_folder', { book: 'prompt' });
    return folder ? { kind: 'picked', folder } : { kind: 'cancelled' };
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : 'That folder could not be added';
    return { kind: 'refused', message };
  }
}

/** Take a folder off that list, once nothing uses it, so it needs the dialog again. */
export function forgetPromptFolder(path: string): Promise<void> {
  return invoke<void>('abs_claude_forget_folder', { path, book: 'prompt' });
}

/**
 * The line each quote starts on in a file of a folder from pickPromptFolder,
 * or null where the file is not in it, is a secret, or does not hold the
 * words. Rust answers with line numbers only, never with what a file holds.
 */
export function findQuotesInFolder(folder: string, quotes: Array<{ file: string; quote: string }>): Promise<Array<number | null>> {
  return invoke<Array<number | null>>('abs_claude_find_quotes', { folder, quotes });
}

/**
 * Whether macOS lets Claude Code open a folder from pickPromptFolder, looked
 * at now (abs_claude_folder_access): "refused" when the user said no to the
 * app for that place, "asking" while macOS waits for an answer, otherwise
 * "open". Off macOS always "open".
 */
export async function lookAtPromptFolder(folder: string): Promise<'open' | 'refused' | 'asking'> {
  const answer = await invoke<string>('abs_claude_folder_access', { folder });
  return answer === 'refused' || answer === 'asking' ? answer : 'open';
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
    return { ready: false, label, detail: 'Claude Code cannot run in the Mac App Store version of Open Screenshot Generator', sandboxed: true };
  }
  if (!detection.found) return { ready: false, label, detail: 'Claude Code is not installed on your computer' };
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
    return { ready: false, label, detail: 'Codex cannot run in the Mac App Store version of Open Screenshot Generator', sandboxed: true };
  }
  if (!detection.found) return { ready: false, label, detail: 'Codex is not installed on your computer' };
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
 * What the newest look found for each CLI, for code that cannot wait for one.
 * The Agent panel looks for itself (its store's detect, and Check again), and
 * notes what it found here too, so translation and Growth see a sign in as
 * soon as any part of the app has.
 */
let known: AgentWriters | null = null;
/**
 * One look at the CLIs, numbered as it starts. The number decides which of two
 * answers is newer, whatever order they land in: two looks can start in the
 * same millisecond, so a time cannot. The time says how old the answer is.
 */
export interface AgentLook {
  order: number;
  at: number;
}
let looks = 0;
/** The look behind each entry of `known`. An older look never replaces a newer one. */
const knownLook: Record<AgentWriter, AgentLook> = { claude: { order: 0, at: 0 }, codex: { order: 0, at: 0 } };
const detectListeners = new Set<() => void>();

/** Number a look that is about to start. */
export function beginAgentLook(): AgentLook {
  looks += 1;
  return { order: looks, at: Date.now() };
}

/** Stands in for the CLI not looked for yet when the other one has been. */
const NOT_LOOKED_FOR: AgentWriters = {
  claude: { ready: false, label: 'Claude Code', detail: 'Looking for Claude Code' },
  codex: { ready: false, label: 'Codex', detail: 'Looking for Codex' },
};

/** Keep `status` if its look started after the one `known` holds. True when it was kept. */
function remember(agent: AgentWriter, status: AgentWriterStatus, look: AgentLook): boolean {
  if (look.order <= knownLook[agent].order) return false;
  knownLook[agent] = look;
  known = { ...(known ?? NOT_LOOKED_FOR), [agent]: status };
  return true;
}

function announceDetection(): void {
  detectListeners.forEach((listener) => listener());
}

/**
 * Which of the two CLIs can answer here. Every detect starts both CLIs, so
 * the first answer is kept and handed to every later call until one asks for
 * `refresh` (after the user installs or signs in, say).
 */
export function detectAgentWriters(options: { refresh?: boolean } = {}): Promise<AgentWriters> {
  if (!detecting || options.refresh) {
    const look = beginAgentLook();
    detecting = Promise.allSettled([
      invoke<ClaudeDetection>('abs_claude_detect'),
      invoke<CodexDetection>('abs_codex_detect'),
    ]).then(([claude, codex]) => {
      const found: AgentWriters = {
        claude: claude.status === 'fulfilled' ? claudeWriterStatus(claude.value) : failedStatus('Claude Code', claude.reason),
        codex: codex.status === 'fulfilled' ? codexWriterStatus(codex.value) : failedStatus('Codex', codex.reason),
      };
      const kept = [remember('claude', found.claude, look), remember('codex', found.codex, look)];
      if (kept.some(Boolean)) announceDetection();
      return known ?? found;
    });
  }
  return detecting;
}

/** What the Agent panel's own look at Claude Code found. `look` is from beginAgentLook, taken as it started. */
export function noteClaudeDetection(detection: ClaudeDetection, look: AgentLook): void {
  if (!detection || typeof detection !== 'object') return;
  if (remember('claude', claudeWriterStatus(detection), look)) announceDetection();
}

/** What the Agent panel's own look at Codex found. `look` is from beginAgentLook, taken as it started. */
export function noteCodexDetection(detection: CodexDetection, look: AgentLook): void {
  if (!detection || typeof detection !== 'object') return;
  if (remember('codex', codexWriterStatus(detection), look)) announceDetection();
}

/** When the newest look at `agent` began, or 0 when there has been none in this window. */
export function agentDetectedAt(agent: AgentWriter): number {
  return knownLook[agent].at;
}

/** What the newest detect found, or null while none has finished in this window. */
export function knownAgentWriters(): AgentWriters | null {
  return known;
}

/** Called each time a detect finishes. Returns the function that stops it. */
export function onAgentWritersDetected(listener: () => void): () => void {
  detectListeners.add(listener);
  return () => {
    detectListeners.delete(listener);
  };
}
