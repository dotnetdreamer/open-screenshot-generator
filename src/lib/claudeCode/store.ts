"use client";

// The agent conversation, owned by the editor window.
//
// One module-level store rather than component state, because nothing that
// renders it lives long enough: the Agent panel unmounts on every tab switch,
// when the dock collapses and when it is detached, and the start dialog that
// begins a chat closes as soon as it has. The store holds the process, folds
// its output into a transcript, and keeps the transcript in localStorage so a
// reload or a relaunch shows the chat and resumes it. Every chat is also saved
// in Past chats (chats.ts), and the chat on screen follows the project the
// editor has open.
//
// A chat talks to one of two CLIs, picked before its first message: Claude
// Code, whose stream-json streamReducer.ts folds, or Codex, whose app-server
// notifications src/lib/codex/reducer.ts folds into the same transcript. A
// Claude Code chat can carry up to three folders of the user's app code
// (folders.ts), which its process is started able to read. A Codex chat has
// none.
//
// A detached panel window never touches this module. It renders the snapshot
// the editor sends it and asks the editor to act (rule 29 in AGENTS.md).

import { useSyncExternalStore } from 'react';
import { db } from '@/database';
import { isTauri } from '@/lib/desktop';
import { clipText } from '@/lib/clipText';
import { OperationRecorder, type OperationStatus } from '@/lib/ai/operationLog';
import { codexTransport } from '@/lib/codex/desktopTransport';
import { clampCodexEffort } from '@/lib/codex/effort';
import { describeCodexExit, failCodexTurn, reduceCodexNotification } from '@/lib/codex/reducer';
import {
  CODEX_EFFORT_CHOICES,
  DEFAULT_CODEX_EFFORT,
  type CodexDetection,
  type CodexEffortChoice,
  type CodexModelChoice,
  type CodexStartInfo,
  type CodexTransport,
  type CodexTransportEvent,
} from '@/lib/codex/types';
import { desktopTransport } from './desktopTransport';
import {
  KEEP_CHATS,
  chatTitle,
  chatUpdatedAt,
  toChatSummary,
  upsertChatSummary,
  type AgentChatRecord,
  type AgentChatSummary,
} from './chats';
import {
  appendNotice,
  appendUserTurn,
  describeExit,
  markExited,
  reduceStreamMessage,
  stripToolPrefix,
} from './streamReducer';
import { composeTurnText, encodeContextUsageRequest, encodeInterrupt, encodeUserMessage } from './prompt';
import {
  CONTEXT_REQUEST_PREFIX,
  answersContextQuestions,
  learnContextWindow,
  sanitizeContextUsage,
  sanitizeContextWindows,
} from './contextUsage';
import {
  FOLDER_CAP_NOTICE,
  FOLDER_PICKER_OPEN,
  MAX_FOLDERS,
  alreadyAddedNotice,
  folderChangeNote,
  folderLabels,
  folderPaths,
  hasUnreadFolder,
  missingFolderNotice,
  sameFolderSet,
  sanitizeFolder,
  sanitizeFolders,
  sanitizePaths,
  savedRanFolders,
  savedReadFolders,
  unreferencedPaths,
} from './folders';
import {
  AGENT_KINDS,
  CLAUDE_EFFORT_CHOICES,
  DEFAULT_CLAUDE_EFFORT,
  INITIAL_AGENT_STATE,
  type AgentContextUsage,
  type AgentDetectionState,
  type AgentEditorContext,
  type AgentFolder,
  type AgentImage,
  type AgentItem,
  type AgentKind,
  type AgentSessionState,
  type ClaudeDetection,
  type ClaudeEffortChoice,
  type ClaudeModelChoice,
  type ClaudeStartInfo,
  type ClaudeTransport,
  type ClaudeTransportEvent,
  type FolderPickerNear,
} from './types';

export interface ClaudeAgentSnapshot {
  /** This build can run the agent at all. Only the desktop app can spawn it. */
  available: boolean;
  session: AgentSessionState;
  /** Claude Code's detection. */
  detection: AgentDetectionState;
  model: ClaudeModelChoice;
  /** Every Claude Code process starts with it. Max unless the user picked another. */
  effort: ClaudeEffortChoice;
  codexDetection: AgentDetectionState<CodexDetection>;
  /** The model every Codex turn asks for: 'default', or one of the detected models' ids. */
  codexModel: CodexModelChoice;
  /** Every Codex turn asks for it, or the highest its model has below it. */
  codexEffort: CodexEffortChoice;
  /** The agent a new chat starts with: the one the user picked last. */
  newChatAgent: AgentKind;
  /** The Agent tab is in the dock. Turned on the first time the agent is picked. */
  panelEnabled: boolean;
  /** Which saved chat the conversation on screen is, and the project it belongs to. */
  chat: AgentChatMeta;
  /** Past chats, newest first. Empty outside the desktop app. */
  chats: AgentChatSummary[];
  /** Rust's folder dialog is open. The add button shows it and ignores clicks meanwhile. */
  folderPicking: boolean;
  /** Why the last folder did not join the chat: a refusal, or the cap. Cleared by the next pick or message. */
  folderNotice: string | null;
  /** The running process can read code folders (agentReadsFolders). */
  foldersLive: boolean;
  /** The chat has a folder the agent was not started with, so a message needs no words of its own. */
  foldersPending: boolean;
}

export interface AgentChatMeta {
  /** Null until the chat's first message, which is when it is first saved. */
  id: string | null;
  /** Which CLI the chat talks to. Switchable until the chat has begun (setChatAgent). */
  agent: AgentKind;
  projectId: string | null;
  projectName: string | null;
  createdAt: number | null;
  /** The chat's code folders, in the order they were added. The next process starts able to read them. */
  folders: AgentFolder[];
  /**
   * A process of this chat was started able to read a code folder. Never
   * cleared for the chat: a resumed conversation still holds what was read,
   * so its replies keep links as text and its tool calls stay off the web.
   */
  readFolders: boolean;
  /**
   * The folder paths the conversation's last turn ran with, set once that
   * turn's message has gone out. Null for a chat that has not run a turn.
   * The folder-change line and foldersPending compare against it.
   */
  ranFolders: string[] | null;
}

const NO_CHAT: AgentChatMeta = {
  id: null,
  agent: 'claude-code',
  projectId: null,
  projectName: null,
  createdAt: null,
  folders: [],
  readFolders: false,
  ranFolders: null,
};

/** What a folder pick came to. */
export type FolderPick =
  | { kind: 'picked'; folder: AgentFolder }
  | { kind: 'cancelled' }
  | { kind: 'refused'; message: string };

export interface AgentTurnInput {
  /** What the user typed. The transcript shows this and nothing else. */
  text: string;
  /**
   * Words only Claude reads, between the editor context and the user's own.
   * A function is called once the process is up, with the chat's folders Rust
   * granted it, so the words never name a folder the agent cannot read.
   */
  preface?: string | ((granted: AgentFolder[]) => string);
  images?: AgentImage[];
  /**
   * Leave out the editor context. The first turn of a new design does: the
   * project it names was created a moment ago and the editor has not rendered
   * it yet, so the context would still describe whatever was open before.
   */
  skipContext?: boolean;
}

const STORAGE_KEY = 'osg-claude-agent-v1';
const MODEL_KEY = 'osg-claude-agent-model';
const EFFORT_KEY = 'osg-claude-agent-effort';
const CODEX_MODEL_KEY = 'osg-codex-agent-model';
const CODEX_EFFORT_KEY = 'osg-codex-agent-effort';
/** The agent a new chat starts with. Nothing until the user picks Codex once, which means Claude Code. */
const AGENT_KEY = 'osg-agent-kind';
const PANEL_KEY = 'osg-claude-agent-panel';
/** The context window each model reported, so a new chat's ring shows from its first call. */
const WINDOWS_KEY = 'osg-claude-agent-windows';
/** Items kept across a reload. The rest of a long chat is still in Claude Code's own file. */
const PERSIST_ITEMS = 150;
const PERSIST_RESULT_CHARS = 300;
/** How long an interrupted turn gets to wind down before the process is killed. */
const INTERRUPT_GRACE_MS = 4000;
/** A detection younger than this is reused rather than spawning `claude` again. */
const DETECT_TTL_MS = 60_000;
/** Stdout arrives in bursts; the layout re-renders once per burst, not per line. */
const NOTIFY_DELAY_MS = 60;

const MODELS: ClaudeModelChoice[] = ['default', 'fable', 'opus', 'sonnet', 'haiku'];
const EFFORTS: ClaudeEffortChoice[] = CLAUDE_EFFORT_CHOICES.map((choice) => choice.value);
const CODEX_EFFORTS: CodexEffortChoice[] = CODEX_EFFORT_CHOICES.map((choice) => choice.value);
/** What Rust takes as a Codex model id (valid_model in codex.rs). */
const CODEX_MODEL_ID = /^[A-Za-z0-9_.][A-Za-z0-9_.-]{0,63}$/;

const SERVER_SNAPSHOT: ClaudeAgentSnapshot = {
  available: false,
  session: INITIAL_AGENT_STATE,
  detection: { status: 'unknown', result: null, error: null },
  model: 'default',
  effort: DEFAULT_CLAUDE_EFFORT,
  codexDetection: { status: 'unknown', result: null, error: null },
  codexModel: 'default',
  codexEffort: DEFAULT_CODEX_EFFORT,
  newChatAgent: 'claude-code',
  panelEnabled: false,
  chat: NO_CHAT,
  chats: [],
  folderPicking: false,
  folderNotice: null,
  foldersLive: false,
  foldersPending: false,
};

let snapshot: ClaudeAgentSnapshot = SERVER_SNAPSHOT;
let hydrated = false;
const listeners = new Set<() => void>();
let notifyTimer: ReturnType<typeof setTimeout> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

let transport: ClaudeTransport | null = null;
let listening: Promise<void> | null = null;
let codexClient: CodexTransport | null = null;
let codexListening: Promise<void> | null = null;
/** The process this window is talking to, if any. Events for any other id are ignored. */
let spawnId: string | null = null;
/** Which CLI that process is. Null with no process. */
let processAgent: AgentKind | null = null;
/**
 * The model choice that process was started with. Null when it is not known
 * (a process adopted after a reload), which makes the next send restart it on
 * the chosen model.
 */
let processModel: ClaudeModelChoice | null = null;
/** The effort that process was started with, null when unknown, as with the model. */
let processEffort: ClaudeEffortChoice | null = null;
/**
 * The code folders that process was started with, as Rust granted them. Null
 * when there is no process, or when nobody knows (one adopted from a build that
 * did not say), which makes the next send restart it.
 */
let processFolders: string[] | null = null;
/**
 * Stop was pressed for the turn in progress. Also covers a turn whose process
 * is still starting: send() checks it before writing and holds the message back.
 */
let stopRequested = false;
let interruptTimer: ReturnType<typeof setTimeout> | null = null;
let stderrTail: string[] = [];
let detectedAt = 0;
let detecting: Promise<ClaudeDetection | null> | null = null;
let codexDetectedAt = 0;
let codexDetecting: Promise<CodexDetection | null> | null = null;
let contextProvider: (() => AgentEditorContext | null) | null = null;
let recorder: OperationRecorder | null = null;
let turnSeq = 0;
/** Bumped by every new chat, so work begun for an older one can tell it is stale. */
let generation = 0;
/** Bumped by every turn, so a timer armed for one turn cannot act on the next. */
let turnToken = 0;
/** The last turn sent, kept so a stale --resume can be retried as a new chat. */
let lastTurn: { line: string; resumedFrom: string | null } | null = null;
/** The page load this page is (ClaudeStartArgs.pageEpoch), read once. */
let pageEpoch: Promise<number | undefined> | null = null;
/** The same for Codex, which counts page loads of its own (codex.rs). */
let codexPageEpoch: Promise<number | undefined> | null = null;
/** Past chats as read at startup. followProject waits for it before it picks one. */
let chatsLoaded: Promise<void> = Promise.resolve();
/**
 * The reload's adoption of a running process. followProject waits for it too:
 * until it is done a turn still running looks stopped, and switching chats
 * then would end it.
 */
let adopted: Promise<void> = Promise.resolve();
/** Bumped by every followProject, so an older one that is still reading gives way. */
let followToken = 0;
/** Context windows by model id, learned from the results of earlier turns (WINDOWS_KEY). */
let contextWindows: Record<string, number> = {};

function readPageEpoch(t: ClaudeTransport): Promise<number | undefined> {
  // Without it Rust judges by when the start arrives, which is still right
  // unless the page reloads mid-invoke.
  pageEpoch ??= t.pageEpoch().catch(() => undefined);
  return pageEpoch;
}

/** Thrown when a start was overtaken by a new chat before it finished. */
class TurnAbandoned extends Error {}

/** Why a Codex chat takes no code folder: Codex has no reads the app can fence to one. */
export const CODEX_NO_FOLDERS = 'Code folders work with Claude Code only';

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

function getTransport(): ClaudeTransport | null {
  if (typeof window === 'undefined') return null;
  if (!transport && isTauri()) transport = desktopTransport;
  return transport;
}

function getCodexTransport(): CodexTransport | null {
  if (typeof window === 'undefined') return null;
  if (!codexClient && isTauri()) codexClient = codexTransport;
  return codexClient;
}

function readCodexPageEpoch(t: CodexTransport): Promise<number | undefined> {
  codexPageEpoch ??= t.pageEpoch().catch(() => undefined);
  return codexPageEpoch;
}

/** Kill a process of either CLI. The conversation stays resumable. */
function stopProcess(id: string, agent: AgentKind | null): void {
  if (agent === 'codex') {
    void getCodexTransport()?.stop(id).catch(() => {});
  } else {
    void getTransport()?.stop(id).catch(() => {});
  }
}

function notifyNow(): void {
  if (notifyTimer) {
    clearTimeout(notifyTimer);
    notifyTimer = null;
  }
  listeners.forEach((listener) => listener());
}

function set(next: Partial<ClaudeAgentSnapshot>, options: { immediate?: boolean } = {}): void {
  snapshot = withFolderFlags({ ...snapshot, ...next });
  schedulePersist();
  if (options.immediate) {
    notifyNow();
  } else if (!notifyTimer) {
    notifyTimer = setTimeout(notifyNow, NOTIFY_DELAY_MS);
  }
}

/**
 * Whether the running process can read code folders now. import_project_image
 * asks before it reads a picture. A Claude Code process whose folders are not
 * known counts as reading them. A Codex process never reads any.
 */
function agentReadsFolders(): boolean {
  return !!spawnId && processAgent !== 'codex' && (processFolders === null || processFolders.length > 0);
}

/**
 * Whether the agent may hold something read from a code folder: its process
 * can read one now, or the chat's agent once could, and the conversation it
 * resumes still has what it read. The MCP server asks before each of the
 * agent's calls and refuses web links while this holds, so nothing read from
 * a folder leaves in a URL. It reads the saved chat first, because the MCP
 * bridge can be up before anything has subscribed to this store.
 */
function agentMayHoldFolderData(): boolean {
  hydrate();
  return agentReadsFolders() || snapshot.chat.readFolders;
}

/** The folder flags follow the process, which lives in module variables rather than in the snapshot. */
function withFolderFlags(state: ClaudeAgentSnapshot): ClaudeAgentSnapshot {
  const foldersLive = agentReadsFolders();
  // A Codex chat never sends its folders anywhere, so none is waiting to be read.
  const foldersPending = state.chat.agent !== 'codex' && hasUnreadFolder(state.chat.folders, state.chat.ranFolders);
  if (state.foldersLive === foldersLive && state.foldersPending === foldersPending) return state;
  return { ...state, foldersLive, foldersPending };
}

/** A process of the chat on screen can read a folder, which marks the chat for as long as it exists. */
function markReadFolders(): void {
  if (!snapshot.chat.readFolders) set({ chat: { ...snapshot.chat, readFolders: true } }, { immediate: true });
}

/** A turn's message went out to a process that reads `paths`, which is what the conversation ran with last. */
function commitRanFolders(paths: string[]): void {
  const { chat } = snapshot;
  if (sameFolderSet(chat.ranFolders, paths)) return;
  set({ chat: { ...chat, ranFolders: paths } }, { immediate: true });
}

/** For a change to the process that no set() follows. */
function refreshFolderFlags(): void {
  const next = withFolderFlags(snapshot);
  if (next === snapshot) return;
  snapshot = next;
  schedulePersist();
  notifyNow();
}

/** This window stops talking to its process. The conversation stays resumable. */
function dropProcess(): void {
  spawnId = null;
  processAgent = null;
  processModel = null;
  processEffort = null;
  processFolders = null;
}

function setSession(session: AgentSessionState, options: { immediate?: boolean } = {}): void {
  if (session !== snapshot.session) set({ session }, options);
}

/** The list alone changes, so nothing about the chat on screen needs saving again. */
function setChats(chats: AgentChatSummary[]): void {
  snapshot = { ...snapshot, chats };
  if (!notifyTimer) notifyTimer = setTimeout(notifyNow, NOTIFY_DELAY_MS);
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Private mode or a full quota: the chat still works, it just will not
    // survive a reload.
  }
}

/** Remember the window a reading reports, for the next chat on its model. */
function learnWindow(context: AgentContextUsage | null): void {
  const next = learnContextWindow(contextWindows, context);
  if (next === contextWindows) return;
  contextWindows = next;
  writeStorage(WINDOWS_KEY, JSON.stringify(next));
}

/**
 * Ask the process how full its context window is. The answer is a
 * control_response the reducer reads, so the ring has Claude Code's own
 * window and count before the first call and right after a summary, rather
 * than at the end of a turn. Only a Claude Code known to answer is asked.
 */
async function askContextUsage(t: ClaudeTransport, id: string): Promise<void> {
  if (!answersContextQuestions(snapshot.detection.result?.version)) return;
  const line = encodeContextUsageRequest(`${CONTEXT_REQUEST_PREFIX}${Date.now().toString(36)}`);
  await t.send(id, line).catch(() => {});
}

/** What survives a reload: enough to show the chat and resume it, no pictures. */
function slimForStorage(items: AgentItem[]): AgentItem[] {
  return items.slice(-PERSIST_ITEMS).map((item) => {
    if (item.kind !== 'tool') return item;
    const { image: _image, ...rest } = item;
    return {
      ...rest,
      input: {},
      result: rest.result === undefined ? undefined : clipText(rest.result, PERSIST_RESULT_CHARS),
    };
  });
}

interface Persisted {
  v: 1;
  sessionId: string | null;
  resolvedModel: string | null;
  spawnId: string | null;
  /** Which CLI the running process is. Missing in older saves, which only knew Claude Code. */
  processAgent?: AgentKind | null;
  /** The choice the running process was started on. Missing in older saves. */
  processModel?: ClaudeModelChoice | null;
  /** The effort the running process was started with. Missing in older saves. */
  processEffort?: ClaudeEffortChoice | null;
  /** The folders the running process was started with. Missing in older saves. */
  processFolders?: string[] | null;
  items: AgentItem[];
  /** Which saved chat this is. Missing in saves from before Past chats. */
  chat?: AgentChatMeta;
  /** The last context reading, for the ring. Missing in older saves. */
  context?: AgentContextUsage | null;
}

function schedulePersist(): void {
  if (!hydrated || persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const { session, chat } = snapshot;
    if (session.status === 'idle' && session.items.length === 0 && !session.sessionId) {
      // An empty chat still remembers its project, so opening that project
      // again after a relaunch does not count as a switch, and the folders the
      // user added before writing anything.
      const empty: Persisted = { v: 1, sessionId: null, resolvedModel: null, spawnId: null, items: [], chat };
      writeStorage(STORAGE_KEY, chat.projectId || chat.folders.length ? JSON.stringify(empty) : null);
      return;
    }
    const persisted: Persisted = {
      v: 1,
      sessionId: session.sessionId,
      resolvedModel: session.model,
      spawnId,
      processAgent,
      processModel,
      processEffort,
      processFolders,
      items: slimForStorage(session.items),
      chat,
      context: session.context,
    };
    writeStorage(STORAGE_KEY, JSON.stringify(persisted));
    void saveChat();
  }, 500);
}

function newChatId(): string {
  return `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** The chat on screen, into Past chats. Nothing is saved before its first message. */
function saveChat(): Promise<void> {
  const { session, chat, available } = snapshot;
  const title = chatTitle(session.items);
  if (!available || !chat.id || !title) return Promise.resolve();
  const now = Date.now();
  const record: AgentChatRecord = {
    id: chat.id,
    agent: chat.agent,
    sessionId: session.sessionId,
    projectId: chat.projectId,
    projectName: chat.projectName,
    title,
    model: session.model,
    createdAt: chat.createdAt ?? now,
    updatedAt: chatUpdatedAt(session.items, now),
    items: slimForStorage(session.items),
    folders: chat.folders,
    readFolders: chat.readFolders,
    ranFolders: chat.ranFolders,
    context: session.context,
  };
  setChats(upsertChatSummary(snapshot.chats, toChatSummary(record)));
  return db.agentChats
    .put(record)
    .then(pruneChats)
    .catch((error) => console.error('Could not save the agent chat', error));
}

async function pruneChats(): Promise<void> {
  const count = await db.agentChats.count();
  if (count <= KEEP_CHATS) return;
  const oldest = await db.agentChats.orderBy('updatedAt').limit(count - KEEP_CHATS).primaryKeys();
  await db.agentChats.bulkDelete(oldest);
}

function loadChats(): Promise<void> {
  return db.agentChats
    .orderBy('updatedAt')
    .reverse()
    .limit(KEEP_CHATS)
    .toArray()
    .then((rows) => {
      // A chat saved while this read was running is newer than its row here.
      let list = rows.map(toChatSummary);
      for (const saved of snapshot.chats) list = upsertChatSummary(list, saved);
      setChats(list);
    })
    .catch((error) => console.error('Could not read the past agent chats', error));
}

function isChatMeta(value: unknown): value is AgentChatMeta {
  return isObject(value) && (value.id === null || typeof value.id === 'string');
}

/** A saved agent, or Claude Code for a chat saved before there was a choice. */
function sanitizeAgent(value: unknown): AgentKind {
  return AGENT_KINDS.includes(value as AgentKind) ? (value as AgentKind) : 'claude-code';
}

function hydrate(): void {
  if (hydrated || typeof window === 'undefined') return;
  hydrated = true;
  const available = !!getTransport();
  const storedModel = readStorage(MODEL_KEY) as ClaudeModelChoice | null;
  const model = storedModel && MODELS.includes(storedModel) ? storedModel : 'default';
  const storedEffort = readStorage(EFFORT_KEY) as ClaudeEffortChoice | null;
  const effort = storedEffort && EFFORTS.includes(storedEffort) ? storedEffort : DEFAULT_CLAUDE_EFFORT;
  const storedCodexModel = readStorage(CODEX_MODEL_KEY);
  const codexModel = storedCodexModel && CODEX_MODEL_ID.test(storedCodexModel) ? storedCodexModel : 'default';
  const storedCodexEffort = readStorage(CODEX_EFFORT_KEY) as CodexEffortChoice | null;
  const codexEffort =
    storedCodexEffort && CODEX_EFFORTS.includes(storedCodexEffort) ? storedCodexEffort : DEFAULT_CODEX_EFFORT;
  const newChatAgent = sanitizeAgent(readStorage(AGENT_KEY));
  const panelEnabled = readStorage(PANEL_KEY) === '1';
  try {
    contextWindows = sanitizeContextWindows(JSON.parse(readStorage(WINDOWS_KEY) ?? 'null'));
  } catch {
    contextWindows = {};
  }

  let persisted: Persisted | null = null;
  try {
    const raw = readStorage(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Persisted) : null;
    if (parsed && parsed.v === 1 && Array.isArray(parsed.items)) persisted = parsed;
  } catch {
    persisted = null;
  }

  const session: AgentSessionState = persisted
    ? {
        ...INITIAL_AGENT_STATE,
        sessionId: persisted.sessionId,
        model: persisted.resolvedModel,
        // Whatever was running is not known to be running any more; adopt()
        // below puts it back if the process outlived the reload.
        items: markExited({ ...INITIAL_AGENT_STATE, status: 'stopped', items: persisted.items }, Date.now()).items,
        status: persisted.sessionId || persisted.items.length ? 'stopped' : 'idle',
        context: sanitizeContextUsage(persisted.context),
      }
    : INITIAL_AGENT_STATE;

  let chat: AgentChatMeta = { ...NO_CHAT, agent: newChatAgent };
  if (persisted && isChatMeta(persisted.chat)) {
    const saved = persisted.chat;
    const folders = sanitizeFolders(saved.folders);
    chat = {
      ...NO_CHAT,
      ...saved,
      agent: sanitizeAgent(saved.agent),
      folders,
      readFolders: savedReadFolders(saved.readFolders, folders),
      ranFolders: savedRanFolders(persisted.sessionId, saved.ranFolders, folders),
    };
  }
  // A chat saved before Past chats existed gets an id now, so it is kept like
  // the rest. It learns its project when the editor reports the open one.
  if (!chat.id && chatTitle(session.items)) {
    chat = { ...chat, id: newChatId(), createdAt: session.items[0]?.at ?? Date.now() };
  }

  snapshot = withFolderFlags({
    ...snapshot,
    available,
    model,
    effort,
    codexModel,
    codexEffort,
    newChatAgent,
    panelEnabled,
    session,
    chat,
  });
  const t = getTransport();
  if (available && t) {
    void readPageEpoch(t);
    const savedEffort = persisted?.processEffort;
    adopted = adopt(
      persisted?.spawnId ?? null,
      sanitizeAgent(persisted?.processAgent),
      persisted?.processModel ?? null,
      savedEffort && EFFORTS.includes(savedEffort) ? savedEffort : null,
      sanitizePaths(persisted?.processFolders)
    );
    chatsLoaded = loadChats();
  }
}

/**
 * A reload wipes this module but not the processes Rust is holding. The one
 * this chat was using is carried on with, and Rust says whether it is in the
 * middle of a turn: the page may well have missed the line that ended it.
 * Anything else listed belonged to an editor that no longer exists, and
 * nothing would ever talk to it again.
 *
 * What the process can read comes from Rust's list, which knows. The copy this
 * page saved stands in only when a build's list does not say; with neither,
 * the folders are unknown and the next message restarts the process. A process
 * that can read folders, or may, marks the chat as having read them.
 */
async function adopt(
  id: string | null,
  agent: AgentKind,
  model: ClaudeModelChoice | null,
  effort: ClaudeEffortChoice | null,
  savedFolders: string[] | null
): Promise<void> {
  const gen = generation;
  // Processes of either CLI that a gone editor left are swept whichever one
  // the chat uses.
  await Promise.all([
    adoptClaude(agent === 'claude-code' ? id : null, gen, model, effort, savedFolders),
    adoptCodex(agent === 'codex' ? id : null, gen),
  ]);
}

async function adoptClaude(
  id: string | null,
  gen: number,
  model: ClaudeModelChoice | null,
  effort: ClaudeEffortChoice | null,
  savedFolders: string[] | null
): Promise<void> {
  const t = getTransport();
  if (!t) return;
  try {
    await ensureListener(t);
    const running = await t.list();
    for (const other of running) {
      if (other.spawnId !== id && other.spawnId !== spawnId) void t.stop(other.spawnId).catch(() => {});
    }
    const mine = id ? running.find((session) => session.spawnId === id) : undefined;
    if (!mine || !id) return;
    if (spawnId || gen !== generation) {
      // A message or a new chat got there first, so this process is surplus.
      void t.stop(id).catch(() => {});
      return;
    }
    spawnId = id;
    processAgent = 'claude-code';
    processModel = model;
    processEffort = effort;
    processFolders = sanitizePaths(mine.folders) ?? savedFolders;
    const { chat } = snapshot;
    set({
      chat: {
        ...chat,
        readFolders: chat.readFolders || processFolders === null || processFolders.length > 0,
        ranFolders: processFolders ?? chat.ranFolders,
      },
    });
    setSession(
      { ...snapshot.session, status: mine.busy ? 'working' : 'ready', turnStartedAt: mine.busy ? Date.now() : null },
      { immediate: true }
    );
  } catch {
    // Nothing to adopt. The next message resumes the conversation instead.
  }
}

/**
 * adopt() for Codex: Rust's list says whether the chat's process is still
 * running, mid-turn or not, and which conversation it is on.
 */
async function adoptCodex(id: string | null, gen: number): Promise<void> {
  const t = getCodexTransport();
  if (!t) return;
  try {
    await ensureCodexListener(t);
    const running = await t.list();
    for (const other of running) {
      if (other.spawnId !== id && other.spawnId !== spawnId) void t.stop(other.spawnId).catch(() => {});
    }
    const mine = id ? running.find((session) => session.spawnId === id) : undefined;
    if (!mine || !id) return;
    if (spawnId || gen !== generation) {
      void t.stop(id).catch(() => {});
      return;
    }
    spawnId = id;
    processAgent = 'codex';
    processModel = null;
    processEffort = null;
    processFolders = [];
    setSession(
      {
        ...snapshot.session,
        sessionId: mine.threadId ?? snapshot.session.sessionId,
        status: mine.busy ? 'working' : 'ready',
        turnStartedAt: mine.busy ? Date.now() : null,
      },
      { immediate: true }
    );
  } catch {
    // Nothing to adopt. The next message resumes the conversation instead.
  }
}

function ensureListener(t: ClaudeTransport): Promise<void> {
  if (!listening) {
    listening = t
      .listen(onEvent)
      .then(() => undefined)
      .catch((error) => {
        listening = null;
        throw error;
      });
  }
  return listening;
}

function ensureCodexListener(t: CodexTransport): Promise<void> {
  if (!codexListening) {
    codexListening = t
      .listen(onCodexEvent)
      .then(() => undefined)
      .catch((error) => {
        codexListening = null;
        throw error;
      });
  }
  return codexListening;
}

function errorText(error: unknown, agent: AgentKind = 'claude-code'): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return agent === 'codex' ? 'Something stopped Codex from starting' : 'Something stopped Claude Code from starting';
}

function clearInterruptTimer(): void {
  if (interruptTimer) {
    clearTimeout(interruptTimer);
    interruptTimer = null;
  }
}

function modelArg(choice: ClaudeModelChoice): string | undefined {
  return choice === 'default' ? undefined : choice;
}

// ---------------------------------------------------------------------------
// The run history (Recent runs in the start dialog): one operation per turn
// ---------------------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Claude Code's file tools. The run log keeps only the start of what they
 * return: the log is saved in IndexedDB and goes into downloaded run reports,
 * and the user's source code has no business in either.
 */
const FILE_TOOLS = new Set(['Read', 'Grep', 'Glob']);
const FILE_RESULT_CHARS = 2000;
/** The turn's tool names by tool_use id, since a result names only the id. */
const recordedTools = new Map<string, string>();

function startRecorder(input: AgentTurnInput): void {
  finishRecorder('cancelled');
  recordedTools.clear();
  const codex = snapshot.chat.agent === 'codex';
  const chosen = codex ? snapshot.codexModel : snapshot.model;
  try {
    recorder = new OperationRecorder({
      mode: codex ? 'codex' : 'claude-code',
      provider: codex ? 'codex' : 'claude-code',
      providerLabel: codex ? 'Codex' : 'Claude',
      model: snapshot.session.model ?? (chosen === 'default' ? undefined : chosen),
      instruction: input.text,
      screenshotCount: input.images?.length ?? 0,
    });
  } catch {
    recorder = null;
  }
}

/**
 * What a Codex turn did, for the run log: its replies, and each design tool
 * call with its arguments and result.
 */
function recordCodex(method: string, params: unknown): void {
  if (!recorder || !isObject(params)) return;
  try {
    if (method === 'mcpServer/startupStatus/updated') {
      recorder.note('Codex design tools', `${String(params.name ?? '')}: ${String(params.status ?? '')}`);
      return;
    }
    if (method !== 'item/completed' || !isObject(params.item)) return;
    const item = params.item;
    if (item.type === 'agentMessage' && typeof item.text === 'string' && item.text.trim()) {
      recorder.message('provider-to-app', 'Reply', { detail: item.text });
    } else if (item.type === 'mcpToolCall') {
      const name = String(item.tool ?? 'tool');
      recorder.message('provider-to-app', `Tool call: ${name}`, {
        detail: JSON.stringify(item.arguments ?? {}, null, 2),
        code: name,
      });
      const result = isObject(item.result) ? item.result : null;
      const body = Array.isArray(result?.content)
        ? result.content
            .map((part) => (isObject(part) && typeof part.text === 'string' ? part.text : isObject(part) && part.type === 'image' ? '[image]' : ''))
            .join('\n')
        : isObject(item.error)
          ? String(item.error.message ?? '')
          : '';
      recorder.message('app-to-provider', 'Tool result', {
        detail: body,
        code: item.status === 'failed' ? 'tool-error' : undefined,
      });
    }
  } catch {
    // The log is for looking back; the turn goes ahead without it.
  }
}

/** The message as it went out, once the process it went to is known. */
function recordSent(fullText: string): void {
  try {
    recorder?.message('app-to-provider', 'Message sent', { detail: fullText });
  } catch {
    // The log is for looking back; the turn goes ahead without it.
  }
}

function recordStream(message: unknown): void {
  if (!recorder || !isObject(message)) return;
  if (message.type === 'system' && message.subtype === 'init') {
    const servers = Array.isArray(message.mcp_servers) ? message.mcp_servers : [];
    recorder.note(
      'Claude Code started the turn',
      [
        `model: ${String(message.model ?? '')}`,
        // Not in init: what the process was started with.
        `effort: ${processEffort ?? 'unknown'}`,
        `conversation: ${String(message.session_id ?? '')}`,
        `design tools: ${servers.map((s) => (isObject(s) ? `${String(s.name)} ${String(s.status)}` : '')).join(', ') || 'none'}`,
        `billed through: ${String(message.apiKeySource ?? 'unknown')}`,
      ].join('\n')
    );
    return;
  }
  const inner = isObject(message.message) ? message.message : null;
  const content = Array.isArray(inner?.content) ? inner.content : [];
  if (message.type === 'assistant') {
    for (const block of content) {
      if (!isObject(block)) continue;
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        recorder.message('provider-to-app', 'Reply', { detail: block.text });
      } else if (block.type === 'tool_use') {
        const name = stripToolPrefix(String(block.name ?? 'tool'));
        if (typeof block.id === 'string') recordedTools.set(block.id, name);
        recorder.message('provider-to-app', `Tool call: ${name}`, {
          detail: JSON.stringify(block.input ?? {}, null, 2),
          code: name,
        });
      }
    }
  } else if (message.type === 'user') {
    for (const block of content) {
      if (!isObject(block) || block.type !== 'tool_result') continue;
      const body = Array.isArray(block.content)
        ? block.content
            .map((part) => (isObject(part) && typeof part.text === 'string' ? part.text : isObject(part) && part.type === 'image' ? '[image]' : ''))
            .join('\n')
        : String(block.content ?? '');
      const tool = typeof block.tool_use_id === 'string' ? recordedTools.get(block.tool_use_id) : undefined;
      recorder.message('app-to-provider', 'Tool result', {
        detail: tool && FILE_TOOLS.has(tool) ? clipText(body, FILE_RESULT_CHARS) : body,
        code: block.is_error ? 'tool-error' : undefined,
      });
    }
  }
}

function finishRecorder(status: Exclude<OperationStatus, 'running'>, error?: { code: string; message: string; detail?: string }): void {
  if (!recorder) return;
  const current = recorder;
  recorder = null;
  if (error) current.error(error.code, error.message, error.detail);
  void current.finish(status).catch(() => {});
}

// ---------------------------------------------------------------------------
// Events from the process
// ---------------------------------------------------------------------------

/** The turn ends here, as Stopped, without anything having been sent for it. */
function stoppedBeforeSending(): void {
  stopRequested = false;
  lastTurn = null;
  clearInterruptTimer();
  const now = Date.now();
  setSession(
    appendNotice(
      { ...snapshot.session, status: spawnId ? 'ready' : 'stopped', turnStartedAt: null },
      { id: `notice-stopped-${now}`, tone: 'info', text: 'Stopped' },
      now
    ),
    { immediate: true }
  );
  finishRecorder('cancelled');
}

function onEvent(event: ClaudeTransportEvent): void {
  // Anything else is an older process winding down.
  if (!spawnId || processAgent === 'codex' || event.spawnId !== spawnId) return;
  const now = Date.now();

  if (event.kind === 'stderr') {
    stderrTail.push(event.line);
    if (stderrTail.length > 20) stderrTail.shift();
    return;
  }

  if (event.kind === 'stdout') {
    let message: unknown;
    try {
      message = JSON.parse(event.line);
    } catch {
      return;
    }
    recordStream(message);
    const isResult = isObject(message) && message.type === 'result';
    const next = reduceStreamMessage(snapshot.session, message, now, { folders: snapshot.chat.folders, contextWindows });
    learnWindow(next.context);
    if (isResult && isObject(message)) {
      clearInterruptTimer();
      const stopped = /^abort|interrupt/i.test(String(message.terminal_reason ?? ''));
      const failed = !stopped && (message.is_error === true || message.subtype !== 'success');
      // A stale id comes back as an error result whose `errors` say so, before
      // any init, and the process exits right after.
      const explanation = `${String(message.result ?? '')} ${JSON.stringify(message.errors ?? [])}`;
      if (failed && lastTurn?.resumedFrom && /no conversation found/i.test(explanation)) {
        if (stopRequested) {
          // Stopped while the missing conversation was being looked for.
          // Nothing ran, and the next message starts a fresh one.
          setSession({ ...snapshot.session, sessionId: null, context: null }, { immediate: true });
          stoppedBeforeSending();
          return;
        }
        void retryWithoutResume();
        return;
      }
      finishRecorder(
        stopped ? 'cancelled' : failed ? 'error' : 'success',
        failed ? { code: String(message.subtype ?? 'error'), message: String(message.result ?? 'Claude Code reported an error') } : undefined
      );
      stopRequested = false;
      lastTurn = null;
    }
    setSession(next, { immediate: isResult });
    // A summary leaves the count unknown until the next call; Claude Code's
    // estimate of what is left fills the gap at once.
    const t = getTransport();
    if (t && isObject(message) && message.type === 'system' && message.subtype === 'compact_boundary') {
      void askContextUsage(t, event.spawnId);
    }
    return;
  }

  // exit
  const wasWorking = snapshot.session.status === 'working' || snapshot.session.status === 'starting';
  const tail = event.stderrTail?.length ? event.stderrTail : stderrTail;
  dropProcess();
  clearInterruptTimer();
  if (wasWorking && !stopRequested && lastTurn?.resumedFrom && /no conversation found/i.test(tail.join('\n'))) {
    void retryWithoutResume();
    return;
  }
  let session = markExited(snapshot.session, now);
  if (wasWorking && stopRequested) {
    session = appendNotice(session, { id: `notice-stopped-${now}`, tone: 'info', text: 'Stopped' }, now);
    finishRecorder('cancelled');
  } else if (wasWorking) {
    const message = describeExit(event.code, tail);
    session = appendNotice(session, { id: `notice-exit-${now}`, tone: 'error', text: message }, now);
    finishRecorder('error', { code: 'exit', message, detail: tail.join('\n') });
  }
  stopRequested = false;
  lastTurn = null;
  setSession(session, { immediate: true });
}

/**
 * What a Codex process said. Its notifications fold into the transcript the
 * same way Claude Code's lines do; a turn/start Codex refused and the exit end
 * the turn here.
 */
function onCodexEvent(event: CodexTransportEvent): void {
  if (!spawnId || processAgent !== 'codex' || event.spawnId !== spawnId) return;
  const now = Date.now();

  if (event.kind === 'stderr') {
    stderrTail.push(event.line);
    if (stderrTail.length > 20) stderrTail.shift();
    return;
  }

  if (event.kind === 'notification') {
    recordCodex(event.method, event.params);
    const ended = event.method === 'turn/completed';
    const next = reduceCodexNotification(snapshot.session, event.method, event.params, now, {
      threadId: snapshot.session.sessionId,
    });
    if (ended) {
      clearInterruptTimer();
      const turn = isObject(event.params) && isObject(event.params.turn) ? event.params.turn : null;
      const status = turn ? String(turn.status ?? '') : '';
      const failed = status === 'failed';
      finishRecorder(
        status === 'interrupted' ? 'cancelled' : failed ? 'error' : 'success',
        failed ? { code: 'turn-failed', message: String((isObject(turn?.error) && turn.error.message) || 'Codex reported an error') } : undefined
      );
      stopRequested = false;
    }
    setSession(next, { immediate: ended });
    return;
  }

  if (event.kind === 'turnFailed') {
    clearInterruptTimer();
    stopRequested = false;
    setSession(failCodexTurn(snapshot.session, event.message, now), { immediate: true });
    finishRecorder('error', { code: 'turn-refused', message: event.message });
    return;
  }

  // exit
  const wasWorking = snapshot.session.status === 'working' || snapshot.session.status === 'starting';
  const tail = event.stderrTail?.length ? event.stderrTail : stderrTail;
  dropProcess();
  clearInterruptTimer();
  let session = markExited(snapshot.session, now);
  if (wasWorking && stopRequested) {
    session = appendNotice(session, { id: `notice-stopped-${now}`, tone: 'info', text: 'Stopped' }, now);
    finishRecorder('cancelled');
  } else if (wasWorking) {
    const message = describeCodexExit(event.code, tail);
    session = appendNotice(session, { id: `notice-exit-${now}`, tone: 'error', text: message }, now);
    finishRecorder('error', { code: 'exit', message, detail: tail.join('\n') });
  }
  stopRequested = false;
  lastTurn = null;
  setSession(session, { immediate: true });
}

/**
 * `--resume` pointed at a conversation Claude Code no longer has (it prunes
 * old ones). Start a fresh one and send the same turn again, once.
 */
async function retryWithoutResume(): Promise<void> {
  const t = getTransport();
  const turn = lastTurn;
  lastTurn = null;
  if (!t || !turn) return;
  const old = spawnId;
  dropProcess();
  if (old) void t.stop(old).catch(() => {});
  if (stopRequested) {
    stoppedBeforeSending();
    return;
  }
  const now = Date.now();
  setSession(
    appendNotice(
      // The reading was of the conversation that is gone.
      { ...snapshot.session, sessionId: null, context: null },
      { id: `notice-fresh-${now}`, tone: 'info', text: 'The earlier conversation was gone, so this is a new one' },
      now
    ),
    { immediate: true }
  );
  const gen = generation;
  const token = turnToken;
  let id: string | null = null;
  try {
    id = await ensureProcess(t);
    if (gen !== generation || token !== turnToken) return;
    if (stopRequested) {
      stoppedBeforeSending();
      return;
    }
    lastTurn = { line: turn.line, resumedFrom: null };
    const granted = processFolders ?? [];
    await t.send(id, turn.line);
    if (gen === generation && token === turnToken) commitRanFolders(granted);
  } catch (error) {
    if (error instanceof TurnAbandoned || gen !== generation || token !== turnToken) return;
    if (id && spawnId !== id) return;
    failTurn(error);
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** The id of a running process for this chat, starting one if there is none. */
async function ensureProcess(t: ClaudeTransport): Promise<string> {
  const wanted = folderPaths(snapshot.chat.folders);
  // A process started on another model, at another effort or with other
  // folders (or on ones nobody remembers) is replaced, with the conversation
  // resumed, so the change takes effect on the very next message. All three
  // are fixed at spawn.
  if (
    spawnId &&
    (processAgent !== 'claude-code' ||
      processModel !== snapshot.model ||
      processEffort !== snapshot.effort ||
      !sameFolderSet(processFolders, wanted))
  ) {
    const old = spawnId;
    const oldAgent = processAgent;
    dropProcess();
    if (oldAgent === 'codex') await getCodexTransport()?.stop(old).catch(() => {});
    else await t.stop(old).catch(() => {});
  }
  if (spawnId) return spawnId;
  await ensureListener(t);
  const epoch = await readPageEpoch(t);
  // A reload's adoption can land during those waits. That process is checked
  // like any other, so a send never goes to one started with other folders.
  if (spawnId) return ensureProcess(t);
  const id = `cc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  // Set before start() resolves: the process can print its first lines
  // before the invoke returns, and onEvent drops anything for another id. Its
  // folders count as readable from here, so the MCP guard is already up.
  spawnId = id;
  processAgent = 'claude-code';
  processModel = snapshot.model;
  processEffort = snapshot.effort;
  processFolders = wanted;
  stderrTail = [];
  let info: ClaudeStartInfo | undefined;
  try {
    info = await t.start({
      spawnId: id,
      model: modelArg(snapshot.model),
      effort: snapshot.effort,
      resume: snapshot.session.sessionId ?? undefined,
      pageEpoch: epoch,
      ...(wanted.length ? { folders: wanted } : {}),
    });
  } catch (error) {
    if (spawnId === id) dropProcess();
    throw error;
  }
  if (spawnId !== id) {
    // A new chat came in while this process was starting. Rust may not have
    // known the id yet when that chat tried to stop it, so stop it here.
    void t.stop(id).catch(() => {});
    throw new TurnAbandoned();
  }
  // Rust starts the process without any folder that is gone or no longer
  // passes its checks, and says which.
  const missing = new Set(sanitizePaths(info?.missingFolders) ?? []);
  processFolders = wanted.filter((path) => !missing.has(path));
  if (processFolders.length) markReadFolders();
  if (missing.size) dropMissingFolders(missing);
  else refreshFolderFlags();
  // Asked before the turn's message goes out, so the message is the last line
  // Rust's duplicate check compares an IPC retry with.
  await askContextUsage(t, id);
  return id;
}

/** The model a Codex start or turn asks for, or undefined for Codex's own default. */
function codexModelArg(): string | undefined {
  return snapshot.codexModel === 'default' ? undefined : snapshot.codexModel;
}

/**
 * The model and effort a Codex turn goes out with. The effort is the one
 * picked, or the highest the model has below it: Codex refuses a level a
 * model does not take, and its models differ.
 */
function codexTurnChoice(): { model?: string; effort: CodexEffortChoice } {
  const model = codexModelArg();
  const models = snapshot.codexDetection.result?.models ?? [];
  const entry = model ? models.find((candidate) => candidate.id === model) : models.find((candidate) => candidate.isDefault);
  return { model, effort: clampCodexEffort(snapshot.codexEffort, entry?.efforts ?? []) };
}

/**
 * The id of a running Codex process for this chat, starting one if there is
 * none. Unlike Claude Code's, a change of model or effort needs no new
 * process: each turn says which it wants.
 */
async function ensureCodexProcess(t: CodexTransport): Promise<string> {
  if (spawnId && processAgent !== 'codex') {
    const old = spawnId;
    dropProcess();
    await getTransport()?.stop(old).catch(() => {});
  }
  if (spawnId) return spawnId;
  // Each turn's effort is held to its model's levels, which only detection
  // lists, and Codex hands a level the model lacks to the API as it is.
  if (!snapshot.codexDetection.result) await detectCodex();
  await ensureCodexListener(t);
  const epoch = await readCodexPageEpoch(t);
  if (spawnId) return ensureCodexProcess(t);
  const id = `cx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  spawnId = id;
  processAgent = 'codex';
  processModel = null;
  processEffort = null;
  processFolders = [];
  stderrTail = [];
  const resume = snapshot.session.sessionId ?? undefined;
  let info: CodexStartInfo;
  try {
    info = await t.start({ spawnId: id, model: codexModelArg(), resume, pageEpoch: epoch });
  } catch (error) {
    if (spawnId === id) dropProcess();
    throw error;
  }
  if (spawnId !== id) {
    void t.stop(id).catch(() => {});
    throw new TurnAbandoned();
  }
  const now = Date.now();
  let session: AgentSessionState = { ...snapshot.session, sessionId: info.threadId, model: info.model ?? snapshot.session.model };
  if (resume && !info.resumed) {
    // Codex keeps no conversation forever. The reading was of the one that is gone.
    session = appendNotice(
      { ...session, context: null },
      { id: `notice-fresh-${now}`, tone: 'info', text: 'The earlier conversation was gone, so this is a new one' },
      now
    );
  }
  if (snapshot.codexDetection.result?.authMethod === 'apiKey' && !session.billedToApiKey) {
    session = appendNotice(
      { ...session, billedToApiKey: true },
      { id: `notice-billing-${now}`, tone: 'warning', text: 'This chat is billed to an OpenAI API key, not your ChatGPT plan' },
      now
    );
  }
  setSession(session, { immediate: true });
  try {
    recorder?.note(
      'Codex started the conversation',
      [
        `model: ${info.model ?? 'default'}`,
        `conversation: ${info.threadId}${resume && !info.resumed ? ' (new, the earlier one was gone)' : ''}`,
        `billed through: ${snapshot.codexDetection.result?.authMethod ?? 'unknown'}`,
      ].join('\n')
    );
  } catch {
    // The log is for looking back.
  }
  refreshFolderFlags();
  return id;
}

/** A message for the chat's Codex process: the same words a Claude Code turn carries, as text and pictures. */
async function sendCodexTurn(
  input: AgentTurnInput,
  context: AgentEditorContext | null,
  gen: number,
  token: number
): Promise<void> {
  const t = getCodexTransport();
  let id: string | null = null;
  try {
    if (!t) throw new Error('Codex runs in the desktop app');
    id = await ensureCodexProcess(t);
    if (gen !== generation || token !== turnToken) return;
    if (stopRequested) {
      stoppedBeforeSending();
      return;
    }
    // A Codex chat has no code folders, so a brief never names one.
    const own = typeof input.preface === 'function' ? input.preface([]) : input.preface;
    const fullText = composeTurnText({ context, preface: own?.trim() ?? '', text: input.text });
    recordSent(fullText);
    lastTurn = null;
    const { model, effort } = codexTurnChoice();
    await t.send(id, { text: fullText, images: input.images ?? [], model, effort });
  } catch (error) {
    if (error instanceof TurnAbandoned || gen !== generation || token !== turnToken) return;
    if (id && spawnId !== id) return;
    failTurn(error);
  }
}

/** Folders the process was started without leave the chat, each with a word in the transcript. */
function dropMissingFolders(missing: Set<string>): void {
  const { chat } = snapshot;
  const gone = chat.folders.filter((folder) => missing.has(folder.path));
  if (!gone.length) {
    refreshFolderFlags();
    return;
  }
  const now = Date.now();
  let session = snapshot.session;
  gone.forEach((folder, index) => {
    session = appendNotice(
      session,
      { id: `notice-folder-${now}-${index}`, tone: 'warning', text: missingFolderNotice(folder) },
      now
    );
  });
  set({ chat: { ...chat, folders: chat.folders.filter((folder) => !missing.has(folder.path)) }, session }, { immediate: true });
  void forgetUnreferenced(gone.map((folder) => folder.path));
}

function failTurn(error: unknown): void {
  const message = errorText(error, snapshot.chat.agent);
  if (spawnId) {
    const dead = spawnId;
    const agent = processAgent;
    dropProcess();
    stopProcess(dead, agent);
  }
  const now = Date.now();
  setSession(
    appendNotice(markExited(snapshot.session, now), { id: `notice-send-${now}`, tone: 'error', text: message }, now),
    { immediate: true }
  );
  finishRecorder('error', { code: 'start-failed', message });
  lastTurn = null;
}

async function send(input: AgentTurnInput): Promise<void> {
  hydrate();
  const codex = snapshot.chat.agent === 'codex';
  const t = getTransport();
  if (!t || (codex && !getCodexTransport())) {
    throw new Error(codex ? 'Codex runs in the desktop app' : 'Claude Code runs in the desktop app');
  }
  const { status } = snapshot.session;
  if (status === 'working' || status === 'starting') {
    throw new Error('The agent is still working. Stop it before sending another message');
  }

  let context: AgentEditorContext | null = null;
  try {
    context = input.skipContext ? null : (contextProvider?.() ?? null);
  } catch {
    context = null;
  }
  const now = Date.now();
  // Whether the conversation has run a turn before, for the folder line once
  // the process is known.
  const continuing = !!snapshot.session.sessionId;
  // Saved from its first message on, and it belongs to the project that
  // message is about. A first message sent without the context has its
  // project from newChat.
  const { chat } = snapshot;
  set(
    {
      chat: {
        ...chat,
        id: chat.id ?? newChatId(),
        createdAt: chat.createdAt ?? now,
        projectId: context?.projectId ?? chat.projectId,
        projectName: context?.projectId ? context.projectName : chat.projectName,
      },
      session: appendUserTurn(
        snapshot.session,
        { id: `u-${now}-${turnSeq++}`, text: input.text, attachments: input.images?.length ?? 0 },
        now
      ),
      folderNotice: null,
    },
    { immediate: true }
  );
  stopRequested = false;
  clearInterruptTimer();
  turnToken += 1;
  const token = turnToken;
  startRecorder(input);

  const gen = generation;
  if (codex) {
    await sendCodexTurn(input, context, gen, token);
    return;
  }
  let id: string | null = null;
  try {
    id = await ensureProcess(t);
    if (gen !== generation || token !== turnToken) return;
    // Stop pressed while the process was still starting: it is up now, and
    // stays up for the next message, but this one never goes out.
    if (stopRequested) {
      stoppedBeforeSending();
      return;
    }
    // Written after the start, not before: the folders Rust granted decide
    // whether the agent is told its folders changed, and which folders the
    // app's own words may name. They become what the conversation ran with
    // only once the message is out, so a turn stopped or failed before that
    // still leaves the line for the next one.
    const granted = processFolders ?? [];
    const folderLine = folderChangeNote(snapshot.chat.ranFolders, granted, continuing);
    const own =
      typeof input.preface === 'function'
        ? input.preface(snapshot.chat.folders.filter((folder) => granted.includes(folder.path)))
        : input.preface;
    const preface = [folderLine, own?.trim()].filter(Boolean).join('\n\n');
    const fullText = composeTurnText({ context, preface, text: input.text });
    const line = encodeUserMessage(fullText, input.images ?? []);
    recordSent(fullText);
    lastTurn = { line, resumedFrom: snapshot.session.sessionId };
    await t.send(id, line);
    if (gen === generation && token === turnToken) commitRanFolders(granted);
  } catch (error) {
    if (error instanceof TurnAbandoned || gen !== generation || token !== turnToken) return;
    // The process died between starting and this write, and its exit event
    // has already put the reason in the transcript.
    if (id && spawnId !== id) return;
    failTurn(error);
  }
}

async function stop(): Promise<void> {
  const t = getTransport();
  const { status } = snapshot.session;
  if (!t || (status !== 'working' && status !== 'starting')) return;
  stopRequested = true;
  const id = spawnId;
  // No process yet: send() sees stopRequested once it is up, and holds the
  // message back.
  if (!id) return;
  const agent = processAgent;
  const token = turnToken;
  clearInterruptTimer();
  // Armed before the interrupt goes out, for this turn only: a turn that ends
  // on its own clears the flag, and the next turn has another token.
  interruptTimer = setTimeout(() => {
    interruptTimer = null;
    if (spawnId === id && turnToken === token && stopRequested && snapshot.session.status === 'working') {
      stopProcess(id, agent);
    }
  }, INTERRUPT_GRACE_MS);
  try {
    // Interrupting keeps the process, and so the conversation, warm.
    if (agent === 'codex') await getCodexTransport()?.interrupt(id);
    else await t.send(id, encodeInterrupt(`stop-${Date.now().toString(36)}`));
  } catch {
    // Rust does not know the id yet (still starting) or the process is gone.
    // In the first case send() holds the message back; in the second the exit
    // event reports it.
  }
}

/** End the process of the chat on screen. Its conversation stays resumable. */
function leaveChat(): void {
  const id = spawnId;
  const agent = processAgent;
  generation += 1;
  dropProcess();
  stopRequested = false;
  lastTurn = null;
  clearInterruptTimer();
  if (id) stopProcess(id, agent);
  finishRecorder('cancelled');
  refreshFolderFlags();
}

/** The project open in the editor now, as the context provider reports it. */
function openProject(): { projectId: string; projectName: string | null } | null {
  try {
    const context = contextProvider?.();
    return context?.projectId ? { projectId: context.projectId, projectName: context.projectName } : null;
  } catch {
    return null;
  }
}

/**
 * An empty chat, for `project` or else the project open now. The chat being
 * left is saved first, so Past chats has it. `folders` are the code folders it
 * starts with: the start screen's, or the chat's own when the panel's New chat
 * stays on the same project. None otherwise, and none for Codex. `agent` is
 * the CLI it talks to, the one picked last when it is not given.
 */
async function newChat(
  project?: { projectId: string | null; projectName: string | null },
  options: { folders?: AgentFolder[]; agent?: AgentKind } = {}
): Promise<void> {
  hydrate();
  void saveChat();
  leaveChat();
  const target = project ?? openProject();
  const agent = options.agent && AGENT_KINDS.includes(options.agent) ? options.agent : snapshot.newChatAgent;
  set(
    {
      session: { ...INITIAL_AGENT_STATE },
      chat: {
        ...NO_CHAT,
        agent,
        projectId: target?.projectId ?? null,
        projectName: target?.projectName ?? null,
        folders: agent === 'codex' ? [] : sanitizeFolders(options.folders ?? []),
      },
      folderNotice: null,
    },
    { immediate: true }
  );
}

/**
 * Point the chat on screen at the other CLI. Only a chat that has not begun
 * can switch: each CLI keeps its conversation in its own files. Either way the
 * choice is what the next new chat starts with. False when the chat kept its
 * agent.
 */
function setChatAgent(agent: AgentKind): boolean {
  hydrate();
  if (!AGENT_KINDS.includes(agent)) return false;
  writeStorage(AGENT_KEY, agent);
  const { session, chat } = snapshot;
  if (chat.agent === agent) {
    if (snapshot.newChatAgent !== agent) set({ newChatAgent: agent });
    return true;
  }
  const begun = session.items.length > 0 || !!session.sessionId || session.status === 'working' || session.status === 'starting';
  if (begun) {
    set({ newChatAgent: agent });
    return false;
  }
  // A process can be up for a chat with nothing in it, after a Stop pressed
  // while it was starting. It belongs to the other CLI now.
  if (spawnId) leaveChat();
  set({ chat: { ...snapshot.chat, agent }, newChatAgent: agent, folderNotice: null }, { immediate: true });
  return true;
}

/**
 * Put a past chat on screen. The next message resumes its conversation.
 * False when it cannot be opened: a turn is running, or the chat is gone.
 */
async function openChat(id: string): Promise<boolean> {
  hydrate();
  const { status } = snapshot.session;
  if (status === 'working' || status === 'starting') return false;
  if (id === snapshot.chat.id) return true;
  void saveChat();
  leaveChat();
  const gen = generation;
  const record = await db.agentChats.get(id).catch(() => undefined);
  if (gen !== generation) return false;
  if (!record) {
    setChats(snapshot.chats.filter((chat) => chat.id !== id));
    return false;
  }
  const items = markExited({ ...INITIAL_AGENT_STATE, status: 'stopped', items: record.items }, Date.now()).items;
  const folders = sanitizeFolders(record.folders);
  set(
    {
      session: {
        ...INITIAL_AGENT_STATE,
        sessionId: record.sessionId,
        model: record.model,
        items,
        status: record.sessionId || items.length ? 'stopped' : 'idle',
        context: sanitizeContextUsage(record.context),
      },
      chat: {
        id: record.id,
        agent: sanitizeAgent(record.agent),
        projectId: record.projectId,
        projectName: record.projectName,
        createdAt: record.createdAt,
        folders,
        readFolders: savedReadFolders(record.readFolders, folders),
        ranFolders: savedRanFolders(record.sessionId, record.ranFolders, folders),
      },
      folderNotice: null,
    },
    { immediate: true }
  );
  return true;
}

/** Forget a past chat. The one on screen stays; start a new chat to leave it first. */
async function deleteChat(id: string): Promise<void> {
  hydrate();
  if (id === snapshot.chat.id) return;
  const gone = snapshot.chats.find((chat) => chat.id === id);
  setChats(snapshot.chats.filter((chat) => chat.id !== id));
  await db.agentChats.delete(id).catch((error) => console.error('Could not delete the agent chat', error));
  const paths = sanitizeFolders(gone?.folders).map((folder) => folder.path);
  if (paths.length) await forgetUnreferenced(paths);
}

// ---------------------------------------------------------------------------
// Code folders
// ---------------------------------------------------------------------------

/**
 * Rust keeps a list of every folder the user picked, and starts a process
 * only with folders on it. One that no chat uses any more comes off, so a
 * folder the user took away cannot be handed back without the dialog.
 */
async function forgetUnreferenced(paths: string[]): Promise<void> {
  const t = getTransport();
  if (!t || !paths.length) return;
  await chatsLoaded;
  const current = snapshot.chat;
  const inUse = [current.folders, ...snapshot.chats.filter((chat) => chat.id !== current.id).map((chat) => chat.folders)];
  for (const path of unreferencedPaths(paths, inUse)) void t.forgetFolder(path).catch(() => {});
}

function pickRefusal(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return typeof error === 'string' && error ? error : 'That folder could not be added';
}

/**
 * Open Rust's folder dialog. `near: 'agent'` puts it over the detached Agent
 * window, when there is one.
 *
 * With `addToChat` (the Agent panel) the folder joins the chat on screen,
 * refusals, the cap and a folder the chat already has show as the folder
 * notice, and the dialog does not open at all once the chat has MAX_FOLDERS. The dialog is modal to one window only,
 * so the chat can change under it (Past chats in a panel on another display):
 * a folder picked for one chat never lands in another, and that pick comes
 * back as cancelled. Without it (the start screen, which holds its own folders
 * until Start) the result is all that happens.
 */
async function pickFolder(options: { near?: FolderPickerNear; addToChat?: boolean } = {}): Promise<FolderPick> {
  hydrate();
  const refuse = (message: string): FolderPick => {
    if (options.addToChat) set({ folderNotice: message }, { immediate: true });
    return { kind: 'refused', message };
  };
  const t = getTransport();
  if (!t) return refuse('Code folders need the desktop app');
  if (options.addToChat && snapshot.chat.agent === 'codex') return refuse(CODEX_NO_FOLDERS);
  if (snapshot.folderPicking) return refuse(FOLDER_PICKER_OPEN);
  if (options.addToChat && snapshot.chat.folders.length >= MAX_FOLDERS) return refuse(FOLDER_CAP_NOTICE);
  const gen = generation;
  set({ folderPicking: true, folderNotice: null }, { immediate: true });
  let chosen: AgentFolder | null;
  try {
    chosen = await t.pickFolder(options.near);
  } catch (error) {
    set({ folderPicking: false }, { immediate: true });
    return refuse(pickRefusal(error));
  }
  set({ folderPicking: false }, { immediate: true });
  if (chosen === null || chosen === undefined) return { kind: 'cancelled' };
  const folder = sanitizeFolder(chosen);
  if (!folder) return refuse('That folder could not be added');
  if (options.addToChat) {
    if (gen !== generation) return { kind: 'cancelled' };
    if (!addFolder(folder)) return { kind: 'refused', message: snapshot.folderNotice ?? FOLDER_CAP_NOTICE };
  }
  return { kind: 'picked', folder };
}

/**
 * Put a folder on the chat on screen. The process picks it up on the next
 * message. False when nothing changed: the folder is already there, or the
 * chat is at the cap. Either way the folder notice says which.
 */
function addFolder(folder: AgentFolder): boolean {
  hydrate();
  const clean = sanitizeFolder(folder);
  if (!clean) return false;
  const { chat } = snapshot;
  if (chat.agent === 'codex') {
    set({ folderNotice: CODEX_NO_FOLDERS }, { immediate: true });
    return false;
  }
  const index = chat.folders.findIndex((entry) => entry.path === clean.path);
  if (index >= 0) {
    // Without a word, picking it again would look like nothing happened.
    set({ folderNotice: alreadyAddedNotice(folderLabels(chat.folders)[index]) }, { immediate: true });
    return false;
  }
  if (chat.folders.length >= MAX_FOLDERS) {
    set({ folderNotice: FOLDER_CAP_NOTICE }, { immediate: true });
    return false;
  }
  set({ chat: { ...chat, folders: [...chat.folders, clean] }, folderNotice: null }, { immediate: true });
  return true;
}

/**
 * Take a folder off the chat on screen. Refused (false) while a turn runs or
 * a process is starting. A process that can read the folder is stopped right
 * away, so access ends when the chip goes rather than on the next message; the
 * conversation stays resumable. Rust forgets the folder once no saved chat
 * uses it.
 */
async function removeFolder(path: string): Promise<boolean> {
  hydrate();
  // Until a reload's adoption is done, a process that outlived the reload
  // looks stopped: it could be mid-turn, and it would keep the folder.
  await adopted;
  const { status } = snapshot.session;
  if (status === 'working' || status === 'starting') return false;
  const { chat } = snapshot;
  if (!chat.folders.some((folder) => folder.path === path)) return false;
  set(
    { chat: { ...chat, folders: chat.folders.filter((folder) => folder.path !== path) }, folderNotice: null },
    { immediate: true }
  );
  if (spawnId && (processFolders === null || processFolders.includes(path))) endIdleProcess();
  await forgetUnreferenced([path]);
  return true;
}

/** Stop the process between turns. The chat's ranFolders stays, so the next message says what changed. */
function endIdleProcess(): void {
  const id = spawnId;
  const agent = processAgent;
  dropProcess();
  lastTurn = null;
  if (id) stopProcess(id, agent);
  setSession(markExited(snapshot.session, Date.now()), { immediate: true });
}

/**
 * The editor opened another project, so the chat on screen follows it: that
 * project's latest chat, or an empty one for it.
 *
 * Not while a turn runs: then it was the agent that opened the project, and
 * the chat goes with it. Its next message ties it to the project it is about.
 */
async function followProject(projectId: string | null, projectName: string | null): Promise<void> {
  hydrate();
  if (!projectId || !snapshot.available) return;
  const token = ++followToken;
  const { chat } = snapshot;
  if (chat.projectId === projectId) {
    if (projectName && chat.projectName !== projectName) set({ chat: { ...chat, projectName } });
    return;
  }
  // A chat that has not learned its project yet (an empty one, or one saved
  // before chats had one) takes this one rather than giving way to it.
  if (!chat.projectId) {
    set({ chat: { ...chat, projectId, projectName } });
    return;
  }
  await Promise.all([chatsLoaded, adopted]);
  const { status } = snapshot.session;
  if (token !== followToken || status === 'working' || status === 'starting') return;
  if (snapshot.chat.projectId === projectId) return;
  const latest = snapshot.chats.find((entry) => entry.projectId === projectId);
  if (latest && (await openChat(latest.id))) return;
  if (token !== followToken) return;
  await newChat({ projectId, projectName });
}

/**
 * Take the Agent tab away. Any turn in progress is stopped and the process
 * ends, but the conversation stays, so turning the tab on again later can
 * carry on from it.
 */
function hidePanel(): void {
  hydrate();
  leaveChat();
  setSession(markExited(snapshot.session, Date.now()), { immediate: true });
  setPanelEnabled(false);
}

async function detect(force = false): Promise<ClaudeDetection | null> {
  hydrate();
  const t = getTransport();
  if (!t) return null;
  if (detecting) return detecting;
  const { detection } = snapshot;
  if (!force && detection.status === 'done' && detection.result && Date.now() - detectedAt < DETECT_TTL_MS) {
    return detection.result;
  }
  set({ detection: { status: 'checking', result: detection.result, error: null } }, { immediate: true });
  detecting = t
    .detect()
    .then((result) => {
      detectedAt = Date.now();
      set({ detection: { status: 'done', result, error: null } }, { immediate: true });
      return result;
    })
    .catch((error) => {
      set({ detection: { status: 'done', result: null, error: errorText(error) } }, { immediate: true });
      return null;
    })
    .finally(() => {
      detecting = null;
    });
  return detecting;
}

/** detect() for Codex: whether it is installed and signed in, and which models the login has. */
async function detectCodex(force = false): Promise<CodexDetection | null> {
  hydrate();
  const t = getCodexTransport();
  if (!t) return null;
  if (codexDetecting) return codexDetecting;
  const detection = snapshot.codexDetection;
  if (!force && detection.status === 'done' && detection.result && Date.now() - codexDetectedAt < DETECT_TTL_MS) {
    return detection.result;
  }
  set({ codexDetection: { status: 'checking', result: detection.result, error: null } }, { immediate: true });
  codexDetecting = t
    .detect()
    .then((result) => {
      codexDetectedAt = Date.now();
      set({ codexDetection: { status: 'done', result, error: null } }, { immediate: true });
      return result;
    })
    .catch((error) => {
      set({ codexDetection: { status: 'done', result: null, error: errorText(error, 'codex') } }, { immediate: true });
      return null;
    })
    .finally(() => {
      codexDetecting = null;
    });
  return codexDetecting;
}

function setModel(model: ClaudeModelChoice): void {
  hydrate();
  if (!MODELS.includes(model) || model === snapshot.model) return;
  writeStorage(MODEL_KEY, model);
  set({ model }, { immediate: true });
}

/** Takes effect on the next Codex turn, which says which model it wants. */
function setCodexModel(model: CodexModelChoice): void {
  hydrate();
  if (model !== 'default' && !CODEX_MODEL_ID.test(model)) return;
  if (model === snapshot.codexModel) return;
  writeStorage(CODEX_MODEL_KEY, model === 'default' ? null : model);
  set({ codexModel: model }, { immediate: true });
}

function setCodexEffort(effort: CodexEffortChoice): void {
  hydrate();
  if (!CODEX_EFFORTS.includes(effort) || effort === snapshot.codexEffort) return;
  writeStorage(CODEX_EFFORT_KEY, effort);
  set({ codexEffort: effort }, { immediate: true });
}

/** Like the model, it takes effect on the next message, which restarts the process. */
function setEffort(effort: ClaudeEffortChoice): void {
  hydrate();
  if (!EFFORTS.includes(effort) || effort === snapshot.effort) return;
  writeStorage(EFFORT_KEY, effort);
  set({ effort }, { immediate: true });
}

function setPanelEnabled(enabled: boolean): void {
  hydrate();
  if (enabled === snapshot.panelEnabled) return;
  writeStorage(PANEL_KEY, enabled ? '1' : null);
  set({ panelEnabled: enabled }, { immediate: true });
}

function subscribe(listener: () => void): () => void {
  hydrate();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ClaudeAgentSnapshot {
  return snapshot;
}

function getServerSnapshot(): ClaudeAgentSnapshot {
  return SERVER_SNAPSHOT;
}

export const claudeAgent = {
  getSnapshot,
  subscribe,
  detect,
  detectCodex,
  send,
  stop,
  newChat,
  setChatAgent,
  openChat,
  deleteChat,
  followProject,
  setModel,
  setEffort,
  setCodexModel,
  setCodexEffort,
  setPanelEnabled,
  hidePanel,
  pickFolder,
  addFolder,
  removeFolder,
  agentReadsFolders,
  agentMayHoldFolderData,
  /** Called with every message to describe what is open and selected. */
  setContextProvider(provider: (() => AgentEditorContext | null) | null): void {
    contextProvider = provider;
  },
};

/**
 * Whether the Agent tab was on when the editor last ran, straight from storage.
 * For code that runs before anything has subscribed, such as the dock
 * restoring its last tab before first paint.
 */
export function readAgentPanelEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return readStorage(PANEL_KEY) === '1' && isTauri();
}

export function useClaudeAgent(): ClaudeAgentSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
