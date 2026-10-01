/**
 * Which project's document the canvas holds, and what may open as a project.
 *
 * The editor names the open project in one piece of state (activeProjectId)
 * and shows its document in another (the artboards). The two part while a
 * project opens: the id already names the incoming project while the canvas
 * still shows the outgoing one, or nothing after a reload. A write computed
 * from the canvas in that window belongs to neither, and saving it under the
 * id is how one project's artboards end up stored as another's.
 */
import type { ArtboardState } from '@/types/artboard';

/** What one render of the editor saw. */
export interface RenderedCanvas {
  /** The project the editor names as open, possibly still opening. */
  activeProjectId: string | null;
  /** The project whose document was on the canvas, null for one never saved. */
  canvasProjectId: string | null;
  /** How many documents had gone onto the canvas by then. */
  serial: number;
}

/**
 * Whether work built in that render may still write to the canvas: the canvas
 * held the open project's document, and no other document has gone onto it
 * since. `liveSerial` is the count when the work runs.
 */
export function canvasStillHolds(rendered: RenderedCanvas, liveSerial: number): boolean {
  return rendered.activeProjectId === rendered.canvasProjectId && rendered.serial === liveSerial;
}

/**
 * Whether a document may open as a project. A project keeps at least one
 * artboard: the editor and delete_artboard both refuse to delete the last one,
 * and a project with none shows the loading skeletons for good, with no
 * artboard left to add the next one from. Refusing an empty document wherever
 * one opens also keeps a state with no artboards off the undo stack.
 */
export function canOpenAsProject(projectData: unknown): projectData is ArtboardState[] {
  return Array.isArray(projectData) && projectData.length > 0;
}
