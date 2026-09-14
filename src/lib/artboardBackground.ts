// One definition of "what colour is this artboard".
//
// A half-filled backgroundGradient is the failure mode worth designing around:
// `linear-gradient(undefineddeg, ...)` is invalid CSS, so the browser computes
// background-image: none and the board renders — and exports — flat white with
// no error anywhere. Projects reach us with one from older saves, imported
// bundles, hand-written template JSON and MCP clients, so the renderer fills
// the gaps instead of dropping the background on the floor.

import type { ArtboardState, Size } from '@/types/artboard';

export const DEFAULT_GRADIENT = { color1: '#00F260', color2: '#0575E6', angle: 45 };

export type PartialGradient = Partial<NonNullable<ArtboardState['backgroundGradient']>> | null | undefined;

/** A complete gradient, with defaults standing in for anything missing. */
export function normalizeGradient(gradient?: PartialGradient) {
  return {
    color1:
      typeof gradient?.color1 === 'string' && gradient.color1 ? gradient.color1 : DEFAULT_GRADIENT.color1,
    color2:
      typeof gradient?.color2 === 'string' && gradient.color2 ? gradient.color2 : DEFAULT_GRADIENT.color2,
    angle:
      typeof gradient?.angle === 'number' && Number.isFinite(gradient.angle)
        ? gradient.angle
        : DEFAULT_GRADIENT.angle,
  };
}

/**
 * The artboard background as a colour plus (for a gradient) an image layer.
 *
 * Kept separate rather than returning the `background` shorthand because the
 * PNG export needs the two halves individually: html-to-image takes a
 * `backgroundColor` option and applies its `style` option to the clone last, so
 * re-stating the gradient there is what guarantees the capture matches the
 * canvas instead of relying on the clone having carried the computed style over.
 */
export function artboardBackground(artboard: {
  backgroundType?: ArtboardState['backgroundType'];
  backgroundGradient?: ArtboardState['backgroundGradient'];
  backgroundColor?: string;
}): { backgroundColor: string; backgroundImage: string } {
  if (artboard.backgroundType === 'gradient') {
    const { color1, color2, angle } = normalizeGradient(artboard.backgroundGradient);
    return {
      // The first stop as the colour layer, so edge antialiasing blends into
      // the gradient rather than into white.
      backgroundColor: color1,
      backgroundImage: `linear-gradient(${angle}deg, ${color1}, ${color2})`,
    };
  }
  const solid =
    !artboard.backgroundColor ||
    artboard.backgroundColor.toLowerCase().includes('var(') ||
    artboard.backgroundColor.toLowerCase().includes('hsl(')
      ? 'white'
      : artboard.backgroundColor;
  return { backgroundColor: solid, backgroundImage: 'none' };
}

/**
 * Where a board's background picture is drawn, in artboard pixels.
 *
 * `left` is negative for every slice but the first: the picture is laid across
 * the whole span and each board clips to its own window onto it. Without a
 * span this is just the board's own box.
 */
export function artboardBackgroundImageBox(artboard: {
  size: Size;
  backgroundImageSlice?: ArtboardState['backgroundImageSlice'];
}): { left: number; width: number; height: number } {
  const slice = artboard.backgroundImageSlice;
  if (!slice || !(slice.totalWidth > 0)) {
    return { left: 0, width: artboard.size.width, height: artboard.size.height };
  }
  return {
    left: -slice.offsetX,
    width: slice.totalWidth,
    // The group's height, not this board's: cover and contain scale from the
    // box they are given, so a shorter board sized against itself would crop a
    // different part of the picture and break the join.
    height: slice.totalHeight > 0 ? slice.totalHeight : artboard.size.height,
  };
}

/** A usable background picture source, or undefined. Empty means "none". */
function backgroundImageSrc(artboard: ArtboardState): string | undefined {
  const src = artboard.backgroundImage;
  return typeof src === 'string' && src.trim() ? src : undefined;
}

/**
 * Settle every board's background picture: who shares it, and which slice of it
 * each board shows.
 *
 * Runs from calculateArtboardPositions, so it happens on every commit next to
 * the other derived board field. Two jobs:
 *
 * 1. A picture set to reach every artboard is put onto any board that has none
 *    of its own. That is what makes a shared background STICK: an artboard
 *    added afterwards, a dropped preview scene and an agent-made board all join
 *    it without any of those writers knowing the feature exists. A board that
 *    already carries a picture is never overwritten, so this can only ever fill
 *    a gap, never undo an edit.
 * 2. Each spanning board's slice is re-derived from the board order, which is
 *    what keeps a span correct after an add, delete, duplicate, reorder or
 *    resize. It is also why no slice index is stored: two people spanning at
 *    once in a live session cannot disagree about a number neither of them
 *    wrote.
 *
 * Returns the input array by reference when nothing changed.
 */
export function normalizeBackgroundImage(artboards: ArtboardState[]): ArtboardState[] {
  // The picture claimed for the whole project, if any. First board in canvas
  // order wins, so the answer never depends on which board was edited last.
  let shared: Pick<
    ArtboardState,
    'backgroundImage' | 'backgroundImageFit' | 'backgroundImageApply' | 'backgroundImageTintColor' | 'backgroundImageTintOpacity'
  > | null = null;
  for (const board of artboards) {
    const src = backgroundImageSrc(board);
    const apply = board.backgroundImageApply;
    if (!src || (apply !== 'all' && apply !== 'span')) continue;
    // The tint travels with the picture: a board joining later that took the
    // picture but not the colour over it would sit in the strip untinted.
    shared = {
      backgroundImage: src,
      backgroundImageFit: board.backgroundImageFit,
      backgroundImageApply: apply,
      backgroundImageTintColor: board.backgroundImageTintColor,
      backgroundImageTintOpacity: board.backgroundImageTintOpacity,
    };
    break;
  }

  let changed = false;
  const filled = shared
    ? artboards.map((board) => {
        if (backgroundImageSrc(board)) return board;
        changed = true;
        return { ...board, ...shared! };
      })
    : artboards;

  const spans = new Map<string, ArtboardState[]>();
  for (const board of filled) {
    const src = backgroundImageSrc(board);
    if (!src || board.backgroundImageApply !== 'span') continue;
    const group = spans.get(src);
    if (group) group.push(board);
    else spans.set(src, [board]);
  }

  const slices = new Map<string, NonNullable<ArtboardState['backgroundImageSlice']>>();
  for (const group of spans.values()) {
    const totalWidth = group.reduce((sum, board) => sum + board.size.width, 0);
    // The tallest board in the group. Boards sit top-aligned on the canvas, so
    // there is no vertical offset to carry, only one shared height.
    const totalHeight = group.reduce((tallest, board) => Math.max(tallest, board.size.height), 0);
    let offsetX = 0;
    for (const board of group) {
      slices.set(board.id, { offsetX, totalWidth, totalHeight });
      offsetX += board.size.width;
    }
  }

  const next = filled.map((board) => {
    const src = backgroundImageSrc(board);
    const slice = slices.get(board.id);
    const current = board.backgroundImageSlice;
    const apply = src ? board.backgroundImageApply : undefined;
    const sameSlice = slice
      ? !!current &&
        current.offsetX === slice.offsetX &&
        current.totalWidth === slice.totalWidth &&
        current.totalHeight === slice.totalHeight
      : !current;
    // A cleared picture arrives as '' rather than a missing key: an intent from
    // a detached panel travels as JSON, and JSON drops an undefined value.
    if (sameSlice && src === board.backgroundImage && apply === board.backgroundImageApply) return board;
    changed = true;
    return {
      ...board,
      backgroundImage: src,
      backgroundImageApply: apply,
      backgroundImageSlice: slice,
    };
  });

  return changed ? next : artboards;
}
