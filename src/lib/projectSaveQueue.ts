/**
 * The debounced write of a project's row (issue #19).
 *
 * A slider commits once per pixel, and rewriting the whole IndexedDB row on
 * every commit would cost hundreds of stringify and structured clone passes
 * per gesture. So a commit only schedules a write, and the row is written once
 * the edits go quiet. One write waits at a time. It carries the project's id, name
 * and artboards as they were when it was scheduled, so it lands on the right
 * row whenever it fires.
 *
 * Only a newer write of the same project replaces the one waiting. A write of
 * another project writes the waiting one first. Projects switch while a write
 * can still be waiting: the project being left stays on the canvas, and open
 * to edits, while the next one is read. Replacing its write then would drop
 * that project's last edits, which were already on screen and reported done.
 */
import type { ArtboardState } from '@/types/artboard';

/** How long the edits have to go quiet before the row is written. */
export const PROJECT_SAVE_DELAY_MS = 600;

/** One row to write. */
export interface ProjectSave {
  id: string;
  name: string;
  artboards: ArtboardState[];
}

export interface ProjectSaveQueue {
  /**
   * Write `save` once nothing newer has been scheduled for the delay. A write
   * of another project still waiting is written now.
   */
  schedule(save: ProjectSave): void;
  /** Write the waiting save now. Resolves when that write settles. */
  flush(): Promise<unknown>;
  /** Write the waiting save now if it belongs to a project other than `projectId`. */
  flushOtherThan(projectId: string): Promise<unknown>;
  /** Forget the waiting save of `projectId` without writing it. */
  drop(projectId: string): void;
}

export function createProjectSaveQueue(
  write: (save: ProjectSave) => Promise<unknown>,
  delayMs: number = PROJECT_SAVE_DELAY_MS
): ProjectSaveQueue {
  let waiting: { save: ProjectSave; timer: ReturnType<typeof setTimeout> } | null = null;

  const flush = (): Promise<unknown> => {
    const current = waiting;
    if (!current) return Promise.resolve();
    waiting = null;
    clearTimeout(current.timer);
    return write(current.save);
  };

  return {
    schedule(save) {
      if (waiting && waiting.save.id !== save.id) void flush();
      else if (waiting) clearTimeout(waiting.timer);
      waiting = { save, timer: setTimeout(() => void flush(), delayMs) };
    },
    flush,
    flushOtherThan(projectId) {
      return waiting && waiting.save.id !== projectId ? flush() : Promise.resolve();
    },
    drop(projectId) {
      if (!waiting || waiting.save.id !== projectId) return;
      clearTimeout(waiting.timer);
      waiting = null;
    },
  };
}
