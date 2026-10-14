// What the Codex side of the agent reports and takes. The conversation it
// produces is the same AgentSessionState the Claude Code side folds into
// (src/lib/claudeCode/types.ts), so the Agent panel draws either one.

import type { AgentImage } from '@/lib/claudeCode/types';

/** What looking for `codex` found. Mirrors CodexDetection in codex.rs. */
export interface CodexDetection {
  found: boolean;
  path?: string | null;
  /** As printed by `codex --version`, for example "codex-cli 0.162.0". */
  version?: string | null;
  loggedIn?: boolean | null;
  /** "chatgpt" for a ChatGPT plan, "apiKey" for an API key. */
  authMethod?: string | null;
  /** "plus", "pro" and so on, for a ChatGPT login. */
  planType?: string | null;
  /** "keyring" when the user's Codex keeps its login in the system keychain. */
  loginStore?: string | null;
  /** The models this login can use, as Codex lists them. */
  models?: CodexModel[];
  /** Why Codex cannot run here whatever is installed ("sandboxed"). */
  unavailable?: string | null;
  error?: string | null;
}

export interface CodexModel {
  /** What turn/start takes, such as "gpt-6.1-sol". */
  id: string;
  /** What Codex's own picker calls it, such as "GPT-6.1-Sol". */
  displayName: string;
  /** The effort levels it takes, in Codex's order. */
  efforts: string[];
  defaultEffort?: string | null;
  /** The model Codex runs when none is named. */
  isDefault: boolean;
}

/**
 * How hard the model thinks before it acts, sent with every turn. Codex's own
 * `ultra` is left out: it hands the work to sub-agents, which this agent has no
 * use for, and Rust refuses it.
 */
export type CodexEffortChoice = 'max' | 'xhigh' | 'high' | 'medium' | 'low' | 'minimal';

/** Max, for the reason DEFAULT_CLAUDE_EFFORT gives. */
export const DEFAULT_CODEX_EFFORT: CodexEffortChoice = 'max';

/** Strongest first, like the Claude Code list. */
export const CODEX_EFFORT_CHOICES: { value: CodexEffortChoice; label: string }[] = [
  { value: 'max', label: 'Max' },
  { value: 'xhigh', label: 'Extra high' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
  { value: 'minimal', label: 'Minimal' },
];

/** 'default' sends no model at all, so Codex runs its own default. */
export type CodexModelChoice = 'default' | string;

/** All the page chooses about a process. The brief is compiled into the app. */
export interface CodexStartArgs {
  spawnId: string;
  /** A Codex model id. Omitted means Codex's own default. */
  model?: string;
  /** The thread id of the conversation to carry on. */
  resume?: string;
  /** What pageEpoch() said when this page loaded (see ClaudeStartArgs.pageEpoch). */
  pageEpoch?: number;
}

export interface CodexStartInfo {
  pid: number;
  /** The conversation the process is on. */
  threadId: string;
  /** False when the conversation asked for was gone and this is a new one. */
  resumed: boolean;
  /** The model Codex runs the conversation on. */
  model?: string | null;
  mcpUrl: string;
}

export interface CodexListedProcess {
  spawnId: string;
  busy: boolean;
  threadId?: string | null;
}

/** One message to Codex: the text, its pictures, and the model and effort for it. */
export interface CodexTurn {
  text: string;
  images: AgentImage[];
  model?: string;
  effort?: CodexEffortChoice;
}

/**
 * One thing a running process did. A notification is one of the app-server's,
 * as codex.rs relays it: only the chat's own thread, pictures over 256KB
 * emptied, the user's own message and reasoning left out.
 */
export type CodexTransportEvent =
  | { spawnId: string; kind: 'notification'; method: string; params: unknown }
  | { spawnId: string; kind: 'stderr'; line: string }
  /** Codex refused a turn/start. The turn never began. */
  | { spawnId: string; kind: 'turnFailed'; message: string }
  | { spawnId: string; kind: 'exit'; code: number | null; stderrTail?: string[] };

/** How the app reaches a `codex app-server` process (codex.rs). */
export interface CodexTransport {
  detect(): Promise<CodexDetection>;
  start(args: CodexStartArgs): Promise<CodexStartInfo>;
  send(spawnId: string, turn: CodexTurn): Promise<void>;
  /** Stop the turn in progress. The process stays up for the next one. */
  interrupt(spawnId: string): Promise<void>;
  /** Kill the process now. The conversation stays resumable. */
  stop(spawnId: string): Promise<void>;
  list(): Promise<CodexListedProcess[]>;
  pageEpoch(): Promise<number>;
  listen(callback: (event: CodexTransportEvent) => void): Promise<() => void>;
}
