"use client";

// The Claude Code conversation, owned by the editor window.
//
// One module-level store rather than component state, because nothing that
// renders it lives long enough: the Agent panel unmounts on every tab switch,
// when the dock collapses and when it is detached, and the start dialog that
// begins a chat closes as soon as it has. The store holds the process, folds
// its stdout into a transcript (streamReducer.ts), and keeps the transcript in
// localStorage so a reload or a relaunch shows the chat and resumes it.
//
// A detached panel window never touches this module. It renders the snapshot
// the editor sends it and asks the editor to act (rule 29 in AGENTS.md).

import { useSyncExternalStore } from 'react';
import { isTauri } from '@/lib/desktop';
import { clipText } from '@/lib/clipText';
import { OperationRecorder, type OperationStatus } from '@/lib/ai/operationLog';
import { desktopTransport } from './desktopTransport';
import {
  appendNotice,
  appendUserTurn,
  describeExit,
  markExited,
  reduceStreamMessage,
  stripToolPrefix,
} from './streamReducer';
import { composeTurnText, encodeInterrupt, encodeUserMessage } from './prompt';
import {
  INITIAL_AGENT_STATE,
  type AgentDetectionState,
  type AgentEditorContext,
  type AgentImage,
  type AgentItem,
  type AgentSessionState,
  type ClaudeDetection,
  type ClaudeModelChoice,
  type ClaudeTransport,
  type ClaudeTransportEvent,
} from './types';

export interface ClaudeAgentSnapshot {
  /** This build can run Claude Code at all. Only the desktop app can spawn it. */
  available: boolean;
  session: AgentSessionState;
  detection: AgentDetectionState;
  model: ClaudeModelChoice;
  /** The Agent tab is in the dock. Turned on the first time Claude Code is picked. */
  panelEnabled: boolean;
}

export interface AgentTurnInput {
  /** What the user typed. The transcript shows this and nothing else. */
  text: string;
  /** Words only Claude reads, between the editor context and the user's own. */
  preface?: string;
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
const PANEL_KEY = 'osg-claude-agent-panel';
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

const SERVER_SNAPSHOT: ClaudeAgentSnapshot = {
  available: false,
  session: INITIAL_AGENT_STATE,
  detection: { status: 'unknown', result: null, error: null },
  model: 'default',
  panelEnabled: false,
};

let snapshot: ClaudeAgentSnapshot = SERVER_SNAPSHOT;
let hydrated = false;
const listeners = new Set<() => void>();
let notifyTimer: ReturnType<typeof setTimeout> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

let transport: ClaudeTransport | null = null;
let listening: Promise<void> | null = null;
/** The process this window is talking to, if any. Events for any other id are ignored. */
let spawnId: string | null = null;
/**
 * The model choice that process was started with. Null when it is not known
 * (a process adopted after a reload), which makes the next send restart it on
 * the chosen model.
 */
let processModel: ClaudeModelChoice | null = null;
/**
 * Stop was pressed for the turn in progress. Also covers a turn whose process
 * is still starting: send() checks it before writing and holds the message back.
 */
let stopRequested = false;
let interruptTimer: ReturnType<typeof setTimeout> | null = null;
let stderrTail: string[] = [];
let detectedAt = 0;
let detecting: Promise<ClaudeDetection | null> | null = null;
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

function readPageEpoch(t: ClaudeTransport): Promise<number | undefined> {
  // Without it Rust judges by when the start arrives, which is still right
  // unless the page reloads mid-invoke.
  pageEpoch ??= t.pageEpoch().catch(() => undefined);
  return pageEpoch;
}

/** Thrown when a start was overtaken by a new chat before it finished. */
class TurnAbandoned extends Error {}

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

function getTransport(): ClaudeTransport | null {
  if (typeof window === 'undefined') return null;
  if (!transport && isTauri()) transport = desktopTransport;
  return transport;
}

function notifyNow(): void {
  if (notifyTimer) {
    clearTimeout(notifyTimer);
    notifyTimer = null;
  }
  listeners.forEach((listener) => listener());
}

function set(next: Partial<ClaudeAgentSnapshot>, options: { immediate?: boolean } = {}): void {
  snapshot = { ...snapshot, ...next };
  schedulePersist();
  if (options.immediate) {
    notifyNow();
  } else if (!notifyTimer) {
    notifyTimer = setTimeout(notifyNow, NOTIFY_DELAY_MS);
  }
}

function setSession(session: AgentSessionState, options: { immediate?: boolean } = {}): void {
  if (session !== snapshot.session) set({ session }, options);
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
  /** The choice the running process was started on. Missing in older saves. */
  processModel?: ClaudeModelChoice | null;
  items: AgentItem[];
}

function schedulePersist(): void {
  if (!hydrated || persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const { session } = snapshot;
    if (session.status === 'idle' && session.items.length === 0 && !session.sessionId) {
      writeStorage(STORAGE_KEY, null);
      return;
    }
    const persisted: Persisted = {
      v: 1,
      sessionId: session.sessionId,
      resolvedModel: session.model,
      spawnId,
      processModel,
      items: slimForStorage(session.items),
    };
    writeStorage(STORAGE_KEY, JSON.stringify(persisted));
  }, 500);
}

function hydrate(): void {
  if (hydrated || typeof window === 'undefined') return;
  hydrated = true;
  const available = !!getTransport();
  const storedModel = readStorage(MODEL_KEY) as ClaudeModelChoice | null;
  const model = storedModel && MODELS.includes(storedModel) ? storedModel : 'default';
  const panelEnabled = readStorage(PANEL_KEY) === '1';

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
      }
    : INITIAL_AGENT_STATE;

  snapshot = { ...snapshot, available, model, panelEnabled, session };
  const t = getTransport();
  if (available && t) {
    void readPageEpoch(t);
    void adopt(persisted?.spawnId ?? null, persisted?.processModel ?? null);
  }
}

/**
 * A reload wipes this module but not the processes Rust is holding. The one
 * this chat was using is carried on with, and Rust says whether it is in the
 * middle of a turn: the page may well have missed the line that ended it.
 * Anything else listed belonged to an editor that no longer exists, and
 * nothing would ever talk to it again.
 */
async function adopt(id: string | null, model: ClaudeModelChoice | null): Promise<void> {
  const t = getTransport();
  if (!t) return;
  const gen = generation;
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
    processModel = model;
    setSession(
      { ...snapshot.session, status: mine.busy ? 'working' : 'ready', turnStartedAt: mine.busy ? Date.now() : null },
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

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'Something stopped Claude Code from starting';
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

function startRecorder(input: AgentTurnInput, fullText: string): void {
  finishRecorder('cancelled');
  try {
    recorder = new OperationRecorder({
      mode: 'claude-code',
      provider: 'claude-code',
      providerLabel: 'Claude',
      model: snapshot.session.model ?? (snapshot.model === 'default' ? undefined : snapshot.model),
      instruction: input.text,
      screenshotCount: input.images?.length ?? 0,
    });
    recorder.message('app-to-provider', 'Message sent', { detail: fullText });
  } catch {
    recorder = null;
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
      recorder.message('app-to-provider', 'Tool result', {
        detail: body,
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
  if (!spawnId || event.spawnId !== spawnId) return;
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
    const next = reduceStreamMessage(snapshot.session, message, now);
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
          setSession({ ...snapshot.session, sessionId: null }, { immediate: true });
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
    return;
  }

  // exit
  const wasWorking = snapshot.session.status === 'working' || snapshot.session.status === 'starting';
  const tail = event.stderrTail?.length ? event.stderrTail : stderrTail;
  spawnId = null;
  processModel = null;
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
 * `--resume` pointed at a conversation Claude Code no longer has (it prunes
 * old ones). Start a fresh one and send the same turn again, once.
 */
async function retryWithoutResume(): Promise<void> {
  const t = getTransport();
  const turn = lastTurn;
  lastTurn = null;
  if (!t || !turn) return;
  const old = spawnId;
  spawnId = null;
  processModel = null;
  if (old) void t.stop(old).catch(() => {});
  if (stopRequested) {
    stoppedBeforeSending();
    return;
  }
  const now = Date.now();
  setSession(
    appendNotice(
      { ...snapshot.session, sessionId: null },
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
    await t.send(id, turn.line);
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
  // A process started on another model (or on one nobody remembers) is
  // replaced, with the conversation resumed, so a model change takes effect on
  // the very next message.
  if (spawnId && processModel !== snapshot.model) {
    const old = spawnId;
    spawnId = null;
    processModel = null;
    await t.stop(old).catch(() => {});
  }
  if (spawnId) return spawnId;
  await ensureListener(t);
  const epoch = await readPageEpoch(t);
  if (spawnId) return spawnId;
  const id = `cc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  // Set before start() resolves: the process can print its first lines
  // before the invoke returns, and onEvent drops anything for another id.
  spawnId = id;
  processModel = snapshot.model;
  stderrTail = [];
  try {
    await t.start({
      spawnId: id,
      model: modelArg(snapshot.model),
      resume: snapshot.session.sessionId ?? undefined,
      pageEpoch: epoch,
    });
  } catch (error) {
    if (spawnId === id) {
      spawnId = null;
      processModel = null;
    }
    throw error;
  }
  if (spawnId !== id) {
    // A new chat came in while this process was starting. Rust may not have
    // known the id yet when that chat tried to stop it, so stop it here.
    void t.stop(id).catch(() => {});
    throw new TurnAbandoned();
  }
  return id;
}

function failTurn(error: unknown): void {
  const t = getTransport();
  const message = errorText(error);
  if (spawnId && t) {
    const dead = spawnId;
    spawnId = null;
    processModel = null;
    void t.stop(dead).catch(() => {});
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
  const t = getTransport();
  if (!t) throw new Error('Claude Code runs in the desktop app');
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
  const fullText = composeTurnText({ context, preface: input.preface, text: input.text });
  const line = encodeUserMessage(fullText, input.images ?? []);
  const now = Date.now();
  setSession(
    appendUserTurn(
      snapshot.session,
      { id: `u-${now}-${turnSeq++}`, text: input.text, attachments: input.images?.length ?? 0 },
      now
    ),
    { immediate: true }
  );
  stopRequested = false;
  clearInterruptTimer();
  turnToken += 1;
  const token = turnToken;
  startRecorder(input, fullText);

  const gen = generation;
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
    lastTurn = { line, resumedFrom: snapshot.session.sessionId };
    await t.send(id, line);
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
  const token = turnToken;
  clearInterruptTimer();
  // Armed before the interrupt goes out, for this turn only: a turn that ends
  // on its own clears the flag, and the next turn has another token.
  interruptTimer = setTimeout(() => {
    interruptTimer = null;
    if (spawnId === id && turnToken === token && stopRequested && snapshot.session.status === 'working') {
      void t.stop(id).catch(() => {});
    }
  }, INTERRUPT_GRACE_MS);
  try {
    // Interrupting keeps the process, and so the conversation, warm.
    await t.send(id, encodeInterrupt(`stop-${Date.now().toString(36)}`));
  } catch {
    // Rust does not know the id yet (still starting) or the process is gone.
    // In the first case send() holds the message back; in the second the exit
    // event reports it.
  }
}

async function newChat(): Promise<void> {
  hydrate();
  const t = getTransport();
  const id = spawnId;
  generation += 1;
  spawnId = null;
  processModel = null;
  stopRequested = false;
  lastTurn = null;
  clearInterruptTimer();
  if (t && id) void t.stop(id).catch(() => {});
  finishRecorder('cancelled');
  setSession({ ...INITIAL_AGENT_STATE }, { immediate: true });
}

/**
 * Take the Agent tab away. Any turn in progress is stopped and the process
 * ends, but the conversation stays, so turning the tab on again later can
 * carry on from it.
 */
function hidePanel(): void {
  hydrate();
  const t = getTransport();
  const id = spawnId;
  generation += 1;
  spawnId = null;
  processModel = null;
  stopRequested = false;
  lastTurn = null;
  clearInterruptTimer();
  if (t && id) void t.stop(id).catch(() => {});
  finishRecorder('cancelled');
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

function setModel(model: ClaudeModelChoice): void {
  hydrate();
  if (!MODELS.includes(model) || model === snapshot.model) return;
  writeStorage(MODEL_KEY, model);
  set({ model }, { immediate: true });
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
  send,
  stop,
  newChat,
  setModel,
  setPanelEnabled,
  hidePanel,
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
