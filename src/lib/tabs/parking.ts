// Where a project waits while its tab is not the active one.
//
// Only the active tab is on the canvas, so one set of WebGL contexts, one set
// of playing videos and one DOM tree exist however many tabs are open. Leaving
// a tab moves its document and its undo stack in here BY REFERENCE: nothing is
// copied, so a switch costs the render of the project being switched to and no
// more. Coming back takes them out again, and the tab carries on with its undo
// history where it left it.
//
// A tab stays here, whole, for an hour after it was left. After that, or sooner
// when the lot goes over its memory budget, it goes to sleep: the lot lets go of
// it and hands it to `onSleep` one last time, which writes its undo stack to
// disk (historyStore.ts). Its project is already there, saved like any other.
// Opening a sleeping tab reads both back, so sleep costs one read and nothing
// else: the undo history comes back with the tab.

import type { ArtboardState } from '@/types/artboard';
import type { HistoryEntry } from '@/lib/historyLabels';

export interface OpenedSnapshot {
  projectId: string;
  boards: ArtboardState[];
  name: string;
}

export interface ParkedProject {
  projectId: string;
  name: string;
  /** The base document, every language, exactly as it was on the canvas. */
  artboards: ArtboardState[];
  history: HistoryEntry[];
  historyIndex: number;
  selectedElementIds: string[];
  /**
   * The state the project was opened in, still waiting to become its "Before
   * this session" version because nothing has been edited yet.
   */
  openedSnapshot: OpenedSnapshot | null;
  /** When the tab was left, or last changed from another tab. Sleep counts from here. */
  parkedAt: number;
}

export interface ParkingBudget {
  /** Summed snapshot bytes the parked projects may hold between them. */
  maxBytes: number;
  /** How many parked projects stay in memory at all. */
  maxProjects: number;
  /** How long a tab stays in memory after it was left. */
  sleepAfterMs: number;
}

/**
 * The defaults. A typical project is about 50KB of JSON now that media lives in
 * its own table, so a full hundred-step history is a few MB and the twenty-tab
 * limit comes long before the byte budget. The budget is for projects that
 * still carry large inline payloads: the macOS webview killed the page with
 * about 500MB of snapshots held (issue #19), and this keeps the parked tabs
 * and the active one together under that. A tab it puts to sleep loses
 * nothing: its undo stack goes to disk (onSleep). The active tab is not
 * counted here, it has its own cap, HISTORY_MAX_BYTES.
 */
export const DEFAULT_PARKING_BUDGET: ParkingBudget = {
  maxBytes: 256 * 1024 * 1024,
  maxProjects: 20,
  sleepAfterMs: 60 * 60 * 1000,
};

/** Why a tab went to sleep: left alone long enough, or the budget needed the room. */
export type SleepReason = 'idle' | 'memory';

/**
 * What a parked project costs, in the serialized bytes the undo stack already
 * measured. The document on the canvas is a separate object graph from the
 * history entry describing it, so the current state counts twice.
 */
export function parkedBytes(project: ParkedProject): number {
  let total = 0;
  for (const entry of project.history) total += entry.bytes;
  total += project.history[project.historyIndex]?.bytes ?? 0;
  return total;
}

export interface ParkingLot {
  /** Keep a project, replacing anything already kept for it, then hold the budget. */
  park(project: ParkedProject): void;
  /** Take a project out. Null when it was never parked, or is asleep. */
  take(projectId: string): ParkedProject | null;
  peek(projectId: string): ParkedProject | null;
  has(projectId: string): boolean;
  /** Let go of a project without putting it to sleep: its tab closed, or was replaced. */
  drop(projectId: string): void;
  /**
   * Change what a parked project holds, for an edit that reaches a tab while it
   * is not on the canvas. False when the project is not parked.
   */
  update(projectId: string, change: (project: ParkedProject) => ParkedProject): boolean;
  /** Put to sleep every tab that was left longer ago than the budget allows. */
  sweep(now?: number): void;
  /** When the next tab is due to sleep. Null when nothing is parked. */
  nextSleepAt(): number | null;
  /** Summed bytes of everything parked. */
  bytes(): number;
  /** Parked ids, most recently parked first. */
  ids(): string[];
}

export function createParkingLot(
  budget: ParkingBudget = DEFAULT_PARKING_BUDGET,
  onSleep?: (project: ParkedProject, reason: SleepReason) => void
): ParkingLot {
  const lot = new Map<string, ParkedProject>();

  const sleep = (project: ParkedProject, reason: SleepReason) => {
    if (lot.get(project.projectId) !== project) return;
    lot.delete(project.projectId);
    onSleep?.(project, reason);
  };

  const oldestFirst = () => [...lot.values()].sort((a, b) => a.parkedAt - b.parkedAt);

  const sweep = (now = Date.now()) => {
    for (const project of oldestFirst()) {
      if (now - project.parkedAt < budget.sleepAfterMs) return;
      sleep(project, 'idle');
    }
  };

  // Over budget: the tabs left longest ago sleep first. Nothing is trimmed from
  // a tab that stays, because a tab that sleeps keeps its whole undo history on
  // disk, and a stack cut short here would be lost for good.
  const enforce = () => {
    let total = 0;
    for (const project of lot.values()) total += parkedBytes(project);
    for (const project of oldestFirst()) {
      if (lot.size <= budget.maxProjects && total <= budget.maxBytes) return;
      total -= parkedBytes(project);
      sleep(project, 'memory');
    }
  };

  return {
    park(project) {
      lot.set(project.projectId, project);
      enforce();
    },
    take(projectId) {
      const project = lot.get(projectId) ?? null;
      lot.delete(projectId);
      return project;
    },
    peek: (projectId) => lot.get(projectId) ?? null,
    has: (projectId) => lot.has(projectId),
    drop(projectId) {
      lot.delete(projectId);
    },
    update(projectId, change) {
      const project = lot.get(projectId);
      if (!project) return false;
      lot.set(projectId, change(project));
      enforce();
      return true;
    },
    sweep,
    nextSleepAt() {
      let next: number | null = null;
      for (const project of lot.values()) {
        const due = project.parkedAt + budget.sleepAfterMs;
        if (next === null || due < next) next = due;
      }
      return next;
    },
    bytes() {
      let total = 0;
      for (const project of lot.values()) total += parkedBytes(project);
      return total;
    },
    ids: () => [...lot.values()].sort((a, b) => b.parkedAt - a.parkedAt).map((project) => project.projectId),
  };
}
