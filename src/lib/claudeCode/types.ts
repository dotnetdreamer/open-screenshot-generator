// Shared shapes for the Claude Code agent: what the transports report, what the
// conversation looks like once the stream has been folded into it, and what the
// dock panel is handed to render.

/** What looking for the `claude` binary found. Mirrors ClaudeDetection in claude_code.rs. */
export interface ClaudeDetection {
  found: boolean;
  path?: string | null;
  /** As printed by `claude --version`, for example "2.1.202 (Claude Code)". */
  version?: string | null;
  /** From `claude auth status`. Null when that command is missing or failed. */
  loggedIn?: boolean | null;
  /** "claude.ai" for a subscription login, otherwise an API key or a cloud provider. */
  authMethod?: string | null;
  /** "pro", "max", "team" and so on, for a subscription login. */
  subscriptionType?: string | null;
  /** Why Claude Code cannot run here whatever is installed ("sandboxed"). */
  unavailable?: string | null;
  error?: string | null;
}

/**
 * All the page chooses about a process. The system prompt and the skills are
 * compiled into the app (src-tauri/claude-agent/), never sent from here.
 */
export interface ClaudeStartArgs {
  spawnId: string;
  /** A Claude Code model alias or full name. Omitted means the user's own default. */
  model?: string;
  /** A conversation id from an earlier `system/init`, to carry on where it stopped. */
  resume?: string;
  /**
   * What `pageEpoch()` said when this page loaded. Rust only sees when a start
   * arrives, and Tauri's IPC can deliver one after its page is gone, so the
   * page says which page it is and Rust kills a start from one that is gone.
   */
  pageEpoch?: number;
}

export interface ClaudeStartInfo {
  pid: number;
  workspace: string;
  mcpUrl: string;
}

/** One thing a running process did. `line` is one line of stream-json on stdout. */
export type ClaudeTransportEvent =
  | { spawnId: string; kind: 'stdout'; line: string }
  | { spawnId: string; kind: 'stderr'; line: string }
  | { spawnId: string; kind: 'exit'; code: number | null; stderrTail?: string[] };

/**
 * How the app reaches a `claude` process. The desktop app spawns it from Rust
 * (desktopTransport.ts). A browser tab cannot spawn anything, so the web build
 * has no transport today; a small local bridge could implement this interface
 * and everything above it would work unchanged.
 */
export interface ClaudeTransport {
  readonly kind: 'desktop' | 'bridge';
  detect(): Promise<ClaudeDetection>;
  start(args: ClaudeStartArgs): Promise<ClaudeStartInfo>;
  /** Write one line of stream-json (a user message) to the process. */
  send(spawnId: string, line: string): Promise<void>;
  /** Let the current turn finish, then exit. */
  closeInput(spawnId: string): Promise<void>;
  /** Kill the process now. The conversation stays resumable. */
  stop(spawnId: string): Promise<void>;
  /**
   * The processes still running, and whether each is mid-turn, so a reloaded
   * editor can adopt its own and knows whether it missed the end of a turn.
   */
  list(): Promise<{ spawnId: string; busy: boolean }[]>;
  /** Which page load this is, as Rust counts them. Read once, sent with every start. */
  pageEpoch(): Promise<number>;
  listen(callback: (event: ClaudeTransportEvent) => void): Promise<() => void>;
}

/** The models offered in the pickers. 'default' passes no --model at all. */
export type ClaudeModelChoice = 'default' | 'fable' | 'opus' | 'sonnet' | 'haiku';

export const CLAUDE_MODEL_CHOICES: { value: ClaudeModelChoice; label: string }[] = [
  { value: 'default', label: 'Your default model' },
  { value: 'fable', label: 'Fable' },
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' },
];

// ---------------------------------------------------------------------------
// The conversation
// ---------------------------------------------------------------------------

export type AgentItem =
  | {
      kind: 'user';
      id: string;
      text: string;
      /** How many pictures went with it. The pictures themselves are not kept. */
      attachments: number;
      at: number;
    }
  | { kind: 'text'; id: string; text: string; at: number }
  | {
      kind: 'tool';
      id: string;
      /** Claude's tool_use id, which the tool_result refers back to. */
      toolUseId: string;
      /** The design tool's own name, without the mcp__server__ prefix. */
      name: string;
      input: Record<string, unknown>;
      /** One short line about the call's arguments, worked out once so it can travel without them. */
      detail?: string;
      status: 'running' | 'done' | 'error';
      /** The tool's text answer, trimmed. */
      result?: string;
      /** A small rendered PNG, when the tool returned one (export_png). */
      image?: string;
      at: number;
      endedAt?: number;
    }
  | { kind: 'notice'; id: string; tone: 'info' | 'warning' | 'error'; text: string; at: number };

/**
 * Where the conversation is.
 *
 * - idle: nothing has been started in this window.
 * - starting: the process is being spawned.
 * - working: a turn is in progress.
 * - ready: the process is alive and waiting for the next message.
 * - stopped: no process, but the conversation can be resumed by sending.
 */
export type AgentStatus = 'idle' | 'starting' | 'working' | 'ready' | 'stopped';

export interface AgentLastTurn {
  durationMs: number;
  turns: number;
  costUsd: number | null;
}

export interface AgentRateLimit {
  status: string;
  resetsAt: number | null;
  type: string | null;
}

export interface AgentSessionState {
  status: AgentStatus;
  /** Claude Code's conversation id, from `system/init`. What --resume takes. */
  sessionId: string | null;
  /** The model the process reported, resolved from whatever alias was asked for. */
  model: string | null;
  items: AgentItem[];
  /** A problem that stops the conversation until the user acts. */
  error: string | null;
  turnStartedAt: number | null;
  lastTurn: AgentLastTurn | null;
  /** Whether Claude Code reached the design tools, from `system/init`. */
  toolsConnected: boolean | null;
  /** `system/init` reported an API key rather than the subscription login. */
  billedToApiKey: boolean;
  rateLimit: AgentRateLimit | null;
}

export const INITIAL_AGENT_STATE: AgentSessionState = {
  status: 'idle',
  sessionId: null,
  model: null,
  items: [],
  error: null,
  turnStartedAt: null,
  lastTurn: null,
  toolsConnected: null,
  billedToApiKey: false,
  rateLimit: null,
};

export interface AgentDetectionState {
  status: 'unknown' | 'checking' | 'done';
  result: ClaudeDetection | null;
  error: string | null;
}

/** A picture going to Claude with a message. */
export interface AgentImage {
  mediaType: string;
  /** Base64, no data: prefix. */
  data: string;
}

/**
 * What the editor knows that a message may be about: which project and board
 * are open and what is selected. Sent with every message, so "make this
 * bigger" can find its "this".
 */
export interface AgentEditorContext {
  projectId: string | null;
  projectName: string | null;
  artboards: { id: string; name: string; width: number; height: number }[];
  activeArtboardId: string | null;
  selection: { id: string; type: string; name?: string; text?: string }[];
  activeLocale: string | null;
}
