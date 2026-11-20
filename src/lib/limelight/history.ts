/**
 * Undo and redo for one open Limelight scene. A scene is small plain data
 * (pictures are ids), so a step is the whole scene as it was. A run of
 * changes with the same `merge` key close together, the frames of one drag
 * or the keys of one typed number, is one step.
 *
 * Undo and redo are changes too: the scene they give back is stamped later
 * than the one on screen. Kept with its old updatedAt, a scene taken back past
 * a save to Google Drive looked older than that save, and opening the Drive
 * copy wrote over it.
 */

import { laterThan } from './edit';
import { sceneMediaIds } from './scene';
import type { LimelightScene } from './types';

const LIMIT = 100;
/** Changes with the same merge key closer together than this are one step. */
const MERGE_MS = 900;

export class SceneHistory {
  private past: LimelightScene[] = [];
  private future: LimelightScene[] = [];
  private lastMerge: string | null = null;
  private lastAt = 0;

  /** Records `before`, the scene as it was before a change. */
  record(before: LimelightScene, merge?: string, now = Date.now()) {
    const merging = merge !== undefined && merge === this.lastMerge && now - this.lastAt < MERGE_MS && this.past.length > 0;
    this.lastMerge = merge ?? null;
    this.lastAt = now;
    this.future = [];
    if (merging) return;
    this.past.push(before);
    if (this.past.length > LIMIT) this.past.shift();
  }

  /** Ends a merge run, so the next change is a step of its own. */
  seal() {
    this.lastMerge = null;
  }

  undo(current: LimelightScene): LimelightScene | null {
    const previous = this.past.pop();
    if (!previous) return null;
    this.future.push(current);
    this.lastMerge = null;
    return { ...previous, updatedAt: laterThan(current.updatedAt) };
  }

  redo(current: LimelightScene): LimelightScene | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(current);
    this.lastMerge = null;
    return { ...next, updatedAt: laterThan(current.updatedAt) };
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Every picture an undo or redo step shows, so none is deleted while a step can bring it back. */
  pictures(): Set<string> {
    const ids = new Set<string>();
    for (const scene of [...this.past, ...this.future]) for (const id of sceneMediaIds(scene)) ids.add(id);
    return ids;
  }

  clear() {
    this.past = [];
    this.future = [];
    this.lastMerge = null;
  }
}
