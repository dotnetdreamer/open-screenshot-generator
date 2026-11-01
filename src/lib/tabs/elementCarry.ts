// An element dragged on the canvas, as the tab strip sees it.
//
// The drag itself belongs to DraggableElement, deep inside the canvas, and the
// tab strip sits above the canvas with no relationship to it. They meet here: a
// module-level channel the drag reports its pointer to, and the strip listens
// on. Module state rather than context, because the drag reports on every
// pointermove and a context update would re-render everything under it.
//
// At the end of the drag the strip gets one chance to take the drop. When it
// does, the drag commits nothing on its own board; the strip moves or copies
// the layers to the tab they were dropped on.

export interface ElementCarry {
  clientX: number;
  clientY: number;
  /** Alt (Option) held: a copy goes, and the original stays. */
  copy: boolean;
  /** The layer the drag started on. The rest of the selection comes with it. */
  elementId: string;
}

type CarryListener = (carry: ElementCarry | null) => void;
/** Answers whether the drop was taken. */
type DropHandler = (carry: ElementCarry) => boolean;

const listeners = new Set<CarryListener>();
let current: ElementCarry | null = null;
let frame: number | null = null;
let dropHandler: DropHandler | null = null;

function notify(): void {
  frame = null;
  for (const listener of listeners) listener(current);
}

/**
 * The drag moved. Listeners hear about it once per frame at most, however fast
 * the pointer events come.
 */
export function moveElementCarry(carry: ElementCarry): void {
  current = carry;
  if (frame === null && typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(notify);
}

/** The drag ended here. True when a drop target took it, so the drag must not commit. */
export function endElementCarry(carry: ElementCarry): boolean {
  const active = current !== null;
  current = null;
  if (frame !== null) {
    cancelAnimationFrame(frame);
    frame = null;
  }
  const taken = active && dropHandler ? dropHandler(carry) : false;
  for (const listener of listeners) listener(null);
  return taken;
}

/** The drag was called off (the OS took the pointer away): nobody gets a drop. */
export function cancelElementCarry(): void {
  if (current === null) return;
  current = null;
  if (frame !== null) {
    cancelAnimationFrame(frame);
    frame = null;
  }
  for (const listener of listeners) listener(null);
}

export function subscribeElementCarry(listener: CarryListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The tab strip's claim on drops. One at a time; the last to register wins. */
export function setElementCarryDropHandler(handler: DropHandler): () => void {
  dropHandler = handler;
  return () => {
    if (dropHandler === handler) dropHandler = null;
  };
}

// --- handing the drag over --------------------------------------------------
//
// When layers are carried into another tab (carrySession.ts), the drag that
// started them has to stop without committing anything, and before the other
// project replaces its canvas: a sleeping tab is read first, and during that
// read the drag would otherwise still be listening for its pointerup.

const abandonListeners = new Set<() => void>();

/** A drag in progress listens for this, and stops where it started if it comes. */
export function onElementCarryAbandoned(listener: () => void): () => void {
  abandonListeners.add(listener);
  return () => {
    abandonListeners.delete(listener);
  };
}

/** Stop the drag that is carrying layers, committing nothing. */
export function abandonElementCarry(): void {
  for (const listener of [...abandonListeners]) listener();
}
