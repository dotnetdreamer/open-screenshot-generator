// The live geometry of an element being dragged, resized or rotated, for the
// other copies of it on neighbouring artboards (see spanArtboards.ts).
//
// DraggableElement keeps a gesture in its own state and only commits on
// release, so nothing above it re-renders during a drag, and a board full of
// 3D devices depends on that. An element that continues onto another artboard
// is drawn by more than one DraggableElement, though, and the others have to
// move with the pointer too. This is the side channel: the copy under the
// pointer publishes, the other copies apply it to their own state, and the
// canvas listens only to learn when the element starts or stops reaching an
// artboard, which is rare enough to afford a re-render.
//
// Geometry here is always in the element's OWN artboard's coordinates; each
// copy adds its own shift.

import type { SpanLiveBox } from '@/lib/spanArtboards';

/** Who is moving the element, so a copy never applies its own gesture back. */
export type SpanLiveSource = object;

type ElementListener = (box: SpanLiveBox, from: SpanLiveSource) => void;

const live = new Map<string, { box: SpanLiveBox; from: SpanLiveSource }>();
const elementListeners = new Map<string, Set<ElementListener>>();
const canvasListeners = new Set<(elementId: string) => void>();

/** The gesture's latest geometry. Called on every pointer move. */
export function publishSpanLive(elementId: string, box: SpanLiveBox, from: SpanLiveSource): void {
  live.set(elementId, { box, from });
  for (const listener of elementListeners.get(elementId) ?? []) listener(box, from);
  for (const listener of canvasListeners) listener(elementId);
}

/**
 * The gesture is over. Called after the commit, so the canvas drops the live
 * geometry in the same render that brings the committed one.
 */
export function endSpanLive(elementId: string, from: SpanLiveSource): void {
  const current = live.get(elementId);
  if (!current || current.from !== from) return;
  live.delete(elementId);
  for (const listener of canvasListeners) listener(elementId);
}

/** Every gesture in progress, by element id. */
export function spanLiveBoxes(): ReadonlyMap<string, SpanLiveBox> {
  const boxes = new Map<string, SpanLiveBox>();
  for (const [id, entry] of live) boxes.set(id, entry.box);
  return boxes;
}

/** The gesture in progress on one element, if there is one. */
export function spanLiveGesture(elementId: string): { box: SpanLiveBox; from: SpanLiveSource } | undefined {
  return live.get(elementId);
}

/** Follow one element's gestures. Returns the unsubscribe. */
export function subscribeSpanLive(elementId: string, listener: ElementListener): () => void {
  let set = elementListeners.get(elementId);
  if (!set) {
    set = new Set();
    elementListeners.set(elementId, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
    if (set && set.size === 0) elementListeners.delete(elementId);
  };
}

/** Hear about every gesture starting, moving and ending. Returns the unsubscribe. */
export function subscribeSpanLiveAll(listener: (elementId: string) => void): () => void {
  canvasListeners.add(listener);
  return () => {
    canvasListeners.delete(listener);
  };
}
