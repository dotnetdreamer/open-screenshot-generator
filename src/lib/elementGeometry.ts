import type { ArtboardElement, Point, Size, TextElementProps } from '@/types/artboard';
import { fitTextBox } from '@/lib/textFit';

/**
 * Element geometry in artboard pixels: where a layer's box is, and the maths
 * that moves several of them at once.
 *
 * Everything here is pure, so align, distribute, nudge and the Properties
 * panel's X/Y/W/H fields all agree about what an element's rectangle is. The
 * layer box is `position` at the top-left and `size * scale` across, the same
 * convention DraggableElement renders and the MCP transform_elements tool
 * already uses.
 */

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A sound has a place on the timeline and none on the canvas. */
export const hasCanvasBox = (element: ArtboardElement): boolean => element.type !== 'audio';

/**
 * The element's layout box: what `left`, `top`, `width` and `height` are set to.
 *
 * Rotation is left out because this is the box the writers here put back, and
 * rotation turns the artwork inside it rather than moving the box.
 */
export function elementBounds(element: ArtboardElement): Bounds {
  const scale = element.scale || 1;
  return {
    x: element.position.x,
    y: element.position.y,
    width: element.size.width * scale,
    height: element.size.height * scale,
  };
}

/**
 * The upright rectangle the element actually covers once it is rotated.
 *
 * A layer turned 45 degrees reaches further left and further up than its layout
 * box does, so aligning on the layout box would leave the two edges a user can
 * see out of line. Rotation is about the centre, so both boxes share a centre
 * and only the extent grows.
 */
export function elementVisualBounds(element: ArtboardElement): Bounds {
  const box = elementBounds(element);
  const degrees = element.rotation || 0;
  if (degrees % 180 === 0) return box;

  const radians = (degrees * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const width = box.width * cos + box.height * sin;
  const height = box.width * sin + box.height * cos;
  return {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
  };
}

/** The rectangle every one of these elements fits inside. */
export function unionBounds(elements: ArtboardElement[]): Bounds | null {
  const boxes = elements.filter(hasCanvasBox).map(elementVisualBounds);
  if (boxes.length === 0) return null;
  const left = Math.min(...boxes.map((b) => b.x));
  const top = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** True when two rectangles share any area, which is what a marquee asks. */
export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

export type AlignEdge = 'left' | 'center-h' | 'right' | 'top' | 'middle-v' | 'bottom';
export type DistributeAxis = 'horizontal' | 'vertical';

/** Where an element has to sit for its visual box to reach `target` on `edge`. */
function positionForEdge(element: ArtboardElement, edge: AlignEdge, target: number): Point {
  const visual = elementVisualBounds(element);
  const box = elementBounds(element);
  // The visual box is centred on the layout box, so the offset between them is
  // the same at both ends and can be applied straight to `position`.
  const offsetX = box.x - visual.x;
  const offsetY = box.y - visual.y;

  switch (edge) {
    case 'left':
      return { x: target + offsetX, y: element.position.y };
    case 'center-h':
      return { x: target - visual.width / 2 + offsetX, y: element.position.y };
    case 'right':
      return { x: target - visual.width + offsetX, y: element.position.y };
    case 'top':
      return { x: element.position.x, y: target + offsetY };
    case 'middle-v':
      return { x: element.position.x, y: target - visual.height / 2 + offsetY };
    case 'bottom':
      return { x: element.position.x, y: target - visual.height + offsetY };
  }
}

/**
 * Align the members against the edge of the rectangle they already span.
 *
 * Aligning to the selection rather than to the artboard is what lets a row of
 * badges line up on the leftmost one instead of jumping to the board's edge.
 * Pass `frame` to align against the artboard instead.
 */
export function alignElements(
  elements: ArtboardElement[],
  memberIds: Set<string>,
  edge: AlignEdge,
  frame?: Bounds
): ArtboardElement[] {
  const members = elements.filter((el) => memberIds.has(el.id) && hasCanvasBox(el));
  if (members.length === 0) return elements;
  const span = frame ?? unionBounds(members);
  if (!span) return elements;

  const target = {
    left: span.x,
    'center-h': span.x + span.width / 2,
    right: span.x + span.width,
    top: span.y,
    'middle-v': span.y + span.height / 2,
    bottom: span.y + span.height,
  }[edge];
  // An edge this does not know is a caller with an unchecked string, and the
  // lookup above answers undefined for it. Moving every member to an undefined
  // coordinate writes `position: undefined`, which vanishes on the way into
  // the saved project and takes the layer's place with it.
  if (typeof target !== 'number') return elements;

  const moving = new Set(members.map((el) => el.id));
  return elements.map((el) =>
    moving.has(el.id) ? ({ ...el, position: positionForEdge(el, edge, target) } as ArtboardElement) : el
  );
}

/**
 * Spread the members so the gaps between them are equal.
 *
 * Equal gaps, not equal centres: with boxes of different widths, evenly spaced
 * centres leave a wide layer crowding its neighbours while the gaps either side
 * of a narrow one gape. The two outermost layers stay where they are, so the
 * arrangement keeps the extent the user gave it.
 *
 * Under three members there is no gap to even out and the list comes back
 * untouched.
 */
export function distributeElements(
  elements: ArtboardElement[],
  memberIds: Set<string>,
  axis: DistributeAxis
): ArtboardElement[] {
  const members = elements.filter((el) => memberIds.has(el.id) && hasCanvasBox(el));
  if (members.length < 3) return elements;

  const horizontal = axis === 'horizontal';
  const measured = members
    .map((el) => ({ el, visual: elementVisualBounds(el) }))
    .sort((a, b) => (horizontal ? a.visual.x - b.visual.x : a.visual.y - b.visual.y));

  // The near edge is the smallest leading edge, which the sort has already put
  // first. The far edge is the largest TRAILING edge, which is not the last
  // member of that sort: a headline behind two badges leads before both of them
  // and still ends after them, and taking its neighbour's edge instead would
  // make the span too short and send the gap sharply negative.
  const spanStart = horizontal ? measured[0].visual.x : measured[0].visual.y;
  const spanEnd = measured.reduce(
    (far, entry) =>
      Math.max(far, horizontal ? entry.visual.x + entry.visual.width : entry.visual.y + entry.visual.height),
    -Infinity
  );
  const occupied = measured.reduce(
    (total, entry) => total + (horizontal ? entry.visual.width : entry.visual.height),
    0
  );
  const gap = (spanEnd - spanStart - occupied) / (measured.length - 1);

  const moved = new Map<string, Point>();
  let cursor = spanStart;
  for (const entry of measured) {
    const edge: AlignEdge = horizontal ? 'left' : 'top';
    moved.set(entry.el.id, positionForEdge(entry.el, edge, cursor));
    cursor += (horizontal ? entry.visual.width : entry.visual.height) + gap;
  }

  return elements.map((el) => {
    const position = moved.get(el.id);
    return position ? ({ ...el, position } as ArtboardElement) : el;
  });
}

/** Shift every member by the same offset, in artboard pixels. */
export function moveElements(
  elements: ArtboardElement[],
  memberIds: Set<string>,
  dx: number,
  dy: number
): ArtboardElement[] {
  if (dx === 0 && dy === 0) return elements;
  return elements.map((el) =>
    memberIds.has(el.id) && hasCanvasBox(el)
      ? ({ ...el, position: { x: el.position.x + dx, y: el.position.y + dy } } as ArtboardElement)
      : el
  );
}

/**
 * The smallest a layer is allowed to get from a typed number.
 *
 * Matches MIN_DISPLAY_SIZE in DraggableElement, so a box cannot be made smaller
 * through the panel than a resize handle would allow.
 */
export const MIN_ELEMENT_SIZE = 20;

/**
 * Rewrite one element's box from the numbers in the Properties panel.
 *
 * Width and height are the RENDERED size, which is `size * scale`, so a layer
 * showing 400 is set back to 400 whatever its scale happens to be. `scale` is
 * left alone and `size` absorbs the change: the two edges move independently,
 * and one multiplier cannot express that.
 *
 * A narrower text box needs more height for the same words, so a width change
 * folds `fitTextBox` in (rule 3). A height the user typed is left as typed.
 */
export function resizeElementBox(
  element: ArtboardElement,
  next: Partial<{ x: number; y: number; width: number; height: number }>,
  /**
   * False while a translated language is on screen. `fitTextBox` measures the
   * text that is rendered and writes a shared `size`, so fitting a long German
   * headline here would resize the English one with it.
   */
  fitText = true
): Partial<ArtboardElement> {
  const scale = element.scale || 1;
  const updates: { position?: Point; size?: Size } = {};

  if (typeof next.x === 'number' || typeof next.y === 'number') {
    updates.position = {
      x: typeof next.x === 'number' ? next.x : element.position.x,
      y: typeof next.y === 'number' ? next.y : element.position.y,
    };
  }

  const widthChanged = typeof next.width === 'number';
  const heightChanged = typeof next.height === 'number';
  if (widthChanged || heightChanged) {
    updates.size = {
      width: widthChanged
        ? Math.max(MIN_ELEMENT_SIZE, next.width as number) / scale
        : element.size.width,
      height: heightChanged
        ? Math.max(MIN_ELEMENT_SIZE, next.height as number) / scale
        : element.size.height,
    };
  }

  if (element.type === 'text' && widthChanged && fitText) {
    const probe = {
      ...(element as TextElementProps),
      ...updates,
      position: updates.position ?? element.position,
      size: updates.size ?? element.size,
    } as TextElementProps;
    const fitted = fitTextBox(probe, probe.content);
    if (fitted) {
      // Only the height is taken. fitTextBox also recentres vertically, which
      // would pull the box away from the Y the user just typed.
      updates.size = { width: probe.size.width, height: fitted.size.height };
    }
  }

  return updates as Partial<ArtboardElement>;
}

/**
 * Every element that moves when one of them is dragged.
 *
 * A layer carrying a `groupId` brings the rest of its group, so picking up one
 * badge picks up the row. Ids with no group contribute only themselves.
 */
export function expandGroups(elements: ArtboardElement[], ids: Iterable<string>): Set<string> {
  const seeds = new Set(ids);
  const groups = new Set<string>();
  for (const el of elements) {
    if (seeds.has(el.id) && el.groupId) groups.add(el.groupId);
  }
  if (groups.size === 0) return seeds;
  const expanded = new Set(seeds);
  for (const el of elements) {
    if (el.groupId && groups.has(el.groupId)) expanded.add(el.id);
  }
  return expanded;
}

/** A fresh group id. The caller supplies the clock so this stays pure. */
export const makeGroupId = (stamp: number): string => `group_${stamp.toString(36)}`;

/** Every element tagged with this group, in z-order. */
export function groupMembers(elements: ArtboardElement[], groupId: string): ArtboardElement[] {
  return elements.filter((el) => el.groupId === groupId);
}

/**
 * What to call a group.
 *
 * Any member's `groupName` will do, since renaming writes the same string to
 * all of them; a group the MCP tool tagged carries none and reads as "Group".
 */
export function groupLabel(members: ArtboardElement[]): string {
  return members.find((el) => el.groupName)?.groupName ?? 'Group';
}

/** "Group 2" when the board already holds a "Group 1". */
export function nextGroupName(elements: ArtboardElement[]): string {
  let highest = 0;
  for (const el of elements) {
    const match = /^Group (\d+)$/.exec(el.groupName ?? '');
    if (match) highest = Math.max(highest, Number.parseInt(match[1], 10));
  }
  return `Group ${highest + 1}`;
}

/**
 * What Group and Ungroup can do with this selection.
 *
 * Group is off once the selection is exactly one whole group, where it would
 * only mint a second id for the same set of layers. A selection that mixes a
 * group with a loose layer, or holds part of a group, still has a grouping to
 * make, so the button stays live for both.
 */
export function groupCommandState(
  elements: ArtboardElement[],
  ids: Iterable<string>
): { canGroup: boolean; canUngroup: boolean; wholeGroupId: string | null } {
  const chosen = new Set(ids);
  const selected = elements.filter((el) => chosen.has(el.id));
  const first = selected[0]?.groupId;
  const isWholeGroup =
    !!first &&
    selected.every((el) => el.groupId === first) &&
    groupMembers(elements, first).length === selected.length;
  return {
    canGroup: selected.length >= 2 && !isWholeGroup,
    canUngroup: selected.some((el) => !!el.groupId),
    wholeGroupId: isWholeGroup ? first : null,
  };
}

/** One line of the Layers list: a loose layer, or a group and its members. */
export type LayerRow =
  | { kind: 'element'; element: ArtboardElement }
  | { kind: 'group'; groupId: string; name: string; members: ArtboardElement[] };

/**
 * The Layers list, top layer first, with each group's members under it.
 *
 * A group sits where its topmost member sits. Membership is a tag rather than a
 * container, so the members of one group can have loose layers between them in
 * z-order; the list shows them together anyway, which is the arrangement the
 * user made, and the up and down buttons still speak about the z-order.
 */
export function buildLayerRows(elements: ArtboardElement[]): LayerRow[] {
  const rows: LayerRow[] = [];
  const placed = new Set<string>();
  for (let i = elements.length - 1; i >= 0; i--) {
    const element = elements[i];
    const groupId = element.groupId;
    if (!groupId) {
      rows.push({ kind: 'element', element });
      continue;
    }
    if (placed.has(groupId)) continue;
    placed.add(groupId);
    const members = groupMembers(elements, groupId).reverse();
    rows.push({ kind: 'group', groupId, name: groupLabel(members), members });
  }
  return rows;
}

/** The same element with no group tag and no group name on it. */
function withoutGroup(element: ArtboardElement): ArtboardElement {
  if (!element.groupId && !element.groupName) return element;
  const { groupId: _dropped, groupName: _unnamed, ...rest } = element;
  return rest as ArtboardElement;
}

/**
 * Move one layer to where the Layers list says it was dropped.
 *
 * `anchorId` is the row the drop line was drawn against and `side` is which
 * side of it in z-order the layer lands on, so the line and the result say the
 * same thing. `groupId` null takes the layer out of whatever group it was in.
 *
 * Returns the array it was given when the drop changes neither the order nor
 * the group, which is the caller's signal not to commit.
 */
export function dropLayer(
  elements: ArtboardElement[],
  dragId: string,
  anchorId: string,
  side: 'above' | 'below',
  groupId: string | null
): ArtboardElement[] {
  if (dragId === anchorId) return elements;
  const dragged = elements.find((el) => el.id === dragId);
  if (!dragged) return elements;
  const rest = elements.filter((el) => el.id !== dragId);
  const anchor = rest.findIndex((el) => el.id === anchorId);
  if (anchor === -1) return elements;
  // The name comes from the group being joined, never from the one being left,
  // and an unnamed group stays unnamed.
  const name = groupId ? groupMembers(rest, groupId).find((el) => el.groupName)?.groupName : undefined;
  const moved = groupId
    ? ({ ...withoutGroup(dragged), groupId, ...(name ? { groupName: name } : {}) } as ArtboardElement)
    : withoutGroup(dragged);
  rest.splice(side === 'above' ? anchor + 1 : anchor, 0, moved);
  const sameOrder = rest.every((el, index) => el.id === elements[index].id);
  if (sameOrder && (dragged.groupId ?? null) === groupId) return elements;
  return rest;
}
