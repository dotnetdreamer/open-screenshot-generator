// The open project as Competitors shows it next to the apps followed: the
// screenshot artboards of one device, without the blank ones, each with what
// it shows of the art that spans into it from its neighbours.

import { screenshotBoards } from '@/lib/creative/specs';
import { computeSpill, spillFor, type BoardSpill } from '@/lib/spanArtboards';
import type { ArtboardState } from '@/types/artboard';

/** Competitors' device switch: iPhone and iPad, or phone and tablet with a Google Play app in the list. */
export type ShotDevice = 'iphone' | 'ipad';

/** Phone boards are long and thin, tablet boards closer to square. */
export function boardDevice(board: ArtboardState): ShotDevice {
  const { width, height } = board.size;
  return Math.max(width, height) / Math.max(1, Math.min(width, height)) >= 1.6 ? 'iphone' : 'ipad';
}

/**
 * A board with nothing on it yet, such as a new blank project's: nothing to
 * compare. Art that spans into it from a neighbour counts as something.
 */
function isBlank(board: ArtboardState, spill: BoardSpill): boolean {
  return board.elements.length === 0 && !board.backgroundImage && spill.behind.length === 0 && spill.front.length === 0;
}

export interface ProjectBoards {
  /** The project has a screenshot artboard with something on it, for any device. */
  any: boolean;
  /** The screenshot artboards of `device` with something on them, in the project's order. */
  boards: ArtboardState[];
  /**
   * What each artboard shows of its neighbours. It is worked out over every
   * artboard, as the export does, before blank ones and other devices are left
   * out: art that spans into an artboard stays on that artboard, and does not
   * move to the next one shown.
   */
  spill: Map<string, BoardSpill>;
}

/** `artboards` in the language on screen, as the editor shows them. */
export function projectBoards(artboards: ArtboardState[], device: ShotDevice): ProjectBoards {
  const spill = computeSpill(artboards);
  const filled = screenshotBoards(artboards).filter((board) => !isBlank(board, spillFor(spill, board.id)));
  return { any: filled.length > 0, boards: filled.filter((board) => boardDevice(board) === device), spill };
}
