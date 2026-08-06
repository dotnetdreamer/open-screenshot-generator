import type { ArtboardElement, ArtboardState, Size } from '@/types/artboard';

// Alignment/distribute modes for the properties panel controls. The six align
// modes run against the artboard for a single selection and against the
// selection's own bounding box for a multi-selection; the distribute modes
// need at least three elements.
export type ElementAlignment =
  | 'left'
  | 'center-h'
  | 'right'
  | 'top'
  | 'middle-v'
  | 'bottom'
  | 'distribute-h'
  | 'distribute-v';

export interface ElementBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

// On-canvas footprint of an element in artboard px. Text ignores element.scale
// when it renders (fontSize drives the glyphs), so its box is the raw size;
// every other type draws at size * scale.
export function elementDisplaySize(element: ArtboardElement): Size {
  if (element.type === 'text') {
    return { width: element.size.width, height: element.size.height };
  }
  const scale = element.scale || 1;
  return { width: element.size.width * scale, height: element.size.height * scale };
}

export function elementBounds(element: ArtboardElement): ElementBounds {
  const { width, height } = elementDisplaySize(element);
  return {
    left: element.position.x,
    top: element.position.y,
    right: element.position.x + width,
    bottom: element.position.y + height,
    width,
    height,
  };
}

export function selectionBounds(elements: ArtboardElement[]): ElementBounds | null {
  if (elements.length === 0) return null;
  const boxes = elements.map(elementBounds);
  const left = Math.min(...boxes.map((b) => b.left));
  const top = Math.min(...boxes.map((b) => b.top));
  const right = Math.max(...boxes.map((b) => b.right));
  const bottom = Math.max(...boxes.map((b) => b.bottom));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

// Returns a new elements array with the given ids aligned, or null when the
// operation would change nothing (so callers can skip a history commit).
// Single selection aligns to the artboard bounds; multi-selection aligns to
// the selection bounding box, with distribute available at 3+ elements.
export function alignElementsWithinArtboard(
  artboard: ArtboardState,
  elementIds: string[],
  mode: ElementAlignment
): ArtboardElement[] | null {
  const wanted = new Set(elementIds);
  const members = artboard.elements.filter((el) => wanted.has(el.id));
  if (members.length === 0) return null;
  if ((mode === 'distribute-h' || mode === 'distribute-v') && members.length < 3) return null;

  const isDistribute = mode === 'distribute-h' || mode === 'distribute-v';
  // A single element aligns inside the artboard itself; a set aligns inside
  // the box the set already occupies.
  const box = members.length === 1
    ? { left: 0, top: 0, right: artboard.size.width, bottom: artboard.size.height, width: artboard.size.width, height: artboard.size.height }
    : selectionBounds(members);
  if (!box) return null;

  const targets = new Map<string, { x: number; y: number }>();

  if (isDistribute) {
    const horizontal = mode === 'distribute-h';
    // Even gaps across the span the selection already covers, keeping the
    // outermost elements pinned. Sort by position so the visual order is kept.
    const sorted = [...members].sort((a, b) =>
      horizontal ? a.position.x - b.position.x : a.position.y - b.position.y
    );
    const sizes = sorted.map(elementDisplaySize);
    const totalSpan = horizontal ? box.width : box.height;
    const totalSizes = sizes.reduce((sum, s) => sum + (horizontal ? s.width : s.height), 0);
    const gap = (totalSpan - totalSizes) / (sorted.length - 1);
    let cursor = horizontal ? box.left : box.top;
    sorted.forEach((el, i) => {
      const size = sizes[i];
      targets.set(el.id, {
        x: horizontal ? cursor : el.position.x,
        y: horizontal ? el.position.y : cursor,
      });
      cursor += (horizontal ? size.width : size.height) + gap;
    });
  } else {
    for (const el of members) {
      const bounds = elementBounds(el);
      let x = el.position.x;
      let y = el.position.y;
      if (mode === 'left') x = box.left;
      else if (mode === 'center-h') x = box.left + (box.width - bounds.width) / 2;
      else if (mode === 'right') x = box.right - bounds.width;
      else if (mode === 'top') y = box.top;
      else if (mode === 'middle-v') y = box.top + (box.height - bounds.height) / 2;
      else if (mode === 'bottom') y = box.bottom - bounds.height;
      targets.set(el.id, { x, y });
    }
  }

  let changed = false;
  const elements = artboard.elements.map((el) => {
    const target = targets.get(el.id);
    if (!target) return el;
    if (target.x !== el.position.x || target.y !== el.position.y) changed = true;
    return { ...el, position: target } as ArtboardElement;
  });
  return changed ? elements : null;
}
