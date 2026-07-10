/**
 * Operation log: a per-request timeline stored in IndexedDB (Dexie).
 *
 * Every AI generate request, in any mode (the "use my account" webview path,
 * the built-in free providers, or an API key), is one "operation". While it
 * runs, an OperationRecorder collects a timeline of what happened: the driver
 * stages, the messages exchanged with the provider (the prompt sent and the
 * raw reply received), screenshots of the provider window at each step, and any
 * error. It is persisted as it goes, so a run that failed, or one that returned
 * a plan that did not build, can be reopened and inspected (or downloaded as a
 * self-contained HTML report) from the info icon on the error and the run
 * history.
 *
 * The record intentionally holds everything needed to render the report on its
 * own: no run-time joins, just the row.
 */

import { db } from '@/database';

export type OperationMode = 'web' | 'free' | 'api';
export type OperationStatus = 'running' | 'success' | 'error' | 'cancelled';

export type TimelineKind =
  | 'stage' // a driver stage transition (opening / attaching / sending / ...)
  | 'message' // a message crossing between the app and the provider
  | 'screenshot' // a captured image of the provider window
  | 'note' // an informational checkpoint
  | 'error'; // a failure

/** Which way a message travelled, for the timeline's arrows. */
export type TimelineDirection = 'app-to-provider' | 'provider-to-app' | 'internal';

export interface TimelineEntry {
  /** epoch ms when this happened; the timeline is sorted by this. */
  t: number;
  kind: TimelineKind;
  /** short one-line summary shown on the timeline rail. */
  label: string;
  direction?: TimelineDirection;
  /** full body: the prompt text, the raw reply, a raw event payload, a stack. */
  detail?: string;
  /** driver stage id, for kind 'stage'. */
  stage?: string;
  /** an error or event code. */
  code?: string;
  /** data URL of a screenshot, for kind 'screenshot'. */
  image?: string;
}

export interface Operation {
  id: string;
  mode: OperationMode;
  /** provider id, e.g. 'gemini' | 'pollinations' | 'anthropic'. */
  provider: string;
  /** display label, e.g. 'Gemini'. */
  providerLabel: string;
  /** model id, where the mode has one (free / api). */
  model?: string;
  /** the user's instruction for this run. */
  instruction: string;
  /** how many screenshots the user attached to the prompt. */
  screenshotCount: number;
  startedAt: number;
  endedAt?: number;
  status: OperationStatus;
  errorCode?: string;
  errorMessage?: string;
  entries: TimelineEntry[];
}

/** Keep the log bounded: only the most recent runs are worth keeping around. */
const MAX_OPERATIONS = 60;
/** A single entry body should never grow unbounded (a giant pasted reply). */
const MAX_DETAIL_CHARS = 200_000;

function newOperationId(): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `op_${Date.now()}_${rand}`;
}

function clampDetail(detail: string | undefined): string | undefined {
  if (detail === undefined) return undefined;
  return detail.length > MAX_DETAIL_CHARS
    ? `${detail.slice(0, MAX_DETAIL_CHARS)}\n... (truncated ${detail.length - MAX_DETAIL_CHARS} more characters)`
    : detail;
}

export interface OperationInit {
  mode: OperationMode;
  provider: string;
  providerLabel: string;
  model?: string;
  instruction: string;
  screenshotCount: number;
}

/**
 * Accumulates a run's timeline and persists it. Writes are coalesced (a run can
 * push a burst of entries) but a finish() always flushes and settles.
 *
 * Every method is safe to call even if persistence fails: the in-memory record
 * is the source of truth for the live UI, and a failed write only means the row
 * will not survive a reload.
 */
export class OperationRecorder {
  private op: Operation;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private tail: Promise<void> = Promise.resolve();

  constructor(init: OperationInit) {
    this.op = {
      id: newOperationId(),
      mode: init.mode,
      provider: init.provider,
      providerLabel: init.providerLabel,
      model: init.model,
      instruction: init.instruction,
      screenshotCount: init.screenshotCount,
      startedAt: Date.now(),
      status: 'running',
      entries: [],
    };
    this.scheduleSave();
  }

  get id(): string {
    return this.op.id;
  }

  /** A stable, plain copy for the live UI (entries sorted by time). */
  snapshot(): Operation {
    return {
      ...this.op,
      entries: [...this.op.entries].sort((a, b) => a.t - b.t),
    };
  }

  private push(entry: TimelineEntry): void {
    this.op.entries.push({ ...entry, detail: clampDetail(entry.detail) });
    this.scheduleSave();
  }

  /** A driver stage transition (opening / login / attaching / ...). */
  stage(stage: string, label: string): void {
    this.push({ t: Date.now(), kind: 'stage', stage, label });
  }

  /** An informational checkpoint that is not a message or a stage. */
  note(label: string, detail?: string): void {
    this.push({ t: Date.now(), kind: 'note', label, detail });
  }

  /** A message crossing between the app and the provider. */
  message(
    direction: TimelineDirection,
    label: string,
    opts: { detail?: string; code?: string } = {}
  ): void {
    this.push({
      t: Date.now(),
      kind: 'message',
      direction,
      label,
      detail: opts.detail,
      code: opts.code,
    });
  }

  /**
   * A screenshot of the provider window. `t` may be passed so a capture that
   * resolved late still lands at the moment it was requested in the timeline.
   */
  screenshot(image: string, label: string, t: number = Date.now()): void {
    this.push({ t, kind: 'screenshot', label, image });
  }

  /** Record a failure. Also stamps the operation's top-level error fields. */
  error(code: string, message: string, detail?: string): void {
    this.op.errorCode = code;
    this.op.errorMessage = message;
    this.push({ t: Date.now(), kind: 'error', label: message, code, detail });
  }

  /** Close the operation and flush the final state to disk. */
  async finish(status: Exclude<OperationStatus, 'running'>): Promise<void> {
    this.op.status = status;
    this.op.endedAt = Date.now();
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.flush();
    // Best-effort trim of old rows; never let it fail the run.
    void pruneOperations().catch(() => {});
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.flush();
    }, 300);
  }

  private flush(): Promise<void> {
    const row = this.snapshot();
    this.tail = this.tail.then(() => db.operations.put(row).then(() => undefined)).catch(() => {});
    return this.tail;
  }
}

// --- queries ----------------------------------------------------------------

/** Newest runs first. */
export async function listOperations(limit = MAX_OPERATIONS): Promise<Operation[]> {
  try {
    return await db.operations.orderBy('startedAt').reverse().limit(limit).toArray();
  } catch {
    return [];
  }
}

export async function getOperation(id: string): Promise<Operation | undefined> {
  try {
    return await db.operations.get(id);
  } catch {
    return undefined;
  }
}

export async function deleteOperation(id: string): Promise<void> {
  try {
    await db.operations.delete(id);
  } catch {
    // ignore
  }
}

export async function clearOperations(): Promise<void> {
  try {
    await db.operations.clear();
  } catch {
    // ignore
  }
}

/** Drop everything older than the newest MAX_OPERATIONS rows. */
export async function pruneOperations(): Promise<void> {
  const stale = await db.operations
    .orderBy('startedAt')
    .reverse()
    .offset(MAX_OPERATIONS)
    .primaryKeys();
  if (stale.length > 0) await db.operations.bulkDelete(stale);
}

// --- formatting helpers (shared by the dialog and the HTML report) ----------

export function operationDurationMs(op: Operation): number | null {
  return op.endedAt ? op.endedAt - op.startedAt : null;
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return 'n/a';
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s - m * 60)}s`;
}

export const STATUS_LABEL: Record<OperationStatus, string> = {
  running: 'Running',
  success: 'Succeeded',
  error: 'Failed',
  cancelled: 'Cancelled',
};

export const MODE_LABEL: Record<OperationMode, string> = {
  web: 'Use my account',
  free: 'Built-in free',
  api: 'API key',
};
