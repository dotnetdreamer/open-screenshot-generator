"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Drag-and-drop for fingers.
 *
 * HTML5 drag and drop (`draggable`, `dragstart`, `dataTransfer`) does not exist
 * on touch: no browser fires a single one of those events for a finger. So the
 * palette's "drag a tile onto a board" gesture is rebuilt here on pointer
 * events, with two rules borrowed from every touch OS:
 *
 * - A drag starts on a LONG PRESS, not on movement. The palette is a dense grid
 *   of tiles with almost no gaps, so a drag armed by movement would mean the
 *   list could never be scrolled: every swipe would begin on a tile.
 * - Once armed, the page must stop scrolling under the finger. That needs
 *   `preventDefault` on a non-passive touchmove, which is only allowed to work
 *   because the long press already proved the finger was holding still.
 *
 * A plain tap is left alone, so the tile's own onClick (which adds the element
 * to the middle of the active board) still runs.
 */

/**
 * Set on <html> for as long as a drag is in flight. On a phone the palette is a
 * sheet sitting over the canvas, and the drop target is underneath it; the
 * matching rules in globals.css fade that sheet and its scrim out of the way
 * without unmounting them (unmounting would take this hook's listeners with it).
 */
const DRAGGING_CLASS = 'palette-dragging';

export interface TouchDragBinding {
  onPointerDown: (event: React.PointerEvent) => void;
  onClickCapture: (event: React.MouseEvent) => void;
}

interface UseTouchDragOptions<T> {
  /** Where the finger let go, in client coordinates. */
  onDrop: (payload: T, point: { x: number; y: number }) => void;
  /** How long the press has to hold still before it becomes a drag. */
  longPressMs?: number;
  /** Movement over this many pixels before the press arms is a scroll. */
  slopPx?: number;
}

interface DragState<T> {
  payload: T;
  pointerId: number;
  startX: number;
  startY: number;
  armed: boolean;
  timer: number | null;
}

export function useTouchDrag<T extends { label: string }>({
  onDrop,
  longPressMs = 320,
  slopPx = 10,
}: UseTouchDragOptions<T>) {
  // Only set once the press has become a drag; drives the ghost that follows
  // the finger.
  const [ghost, setGhost] = useState<{ label: string; x: number; y: number } | null>(null);
  const stateRef = useRef<DragState<T> | null>(null);
  // A drag ends with a pointerup, which the browser follows with a click on the
  // tile. Without this the element would be added twice: once where it was
  // dropped, once in the middle of the board by the tile's onClick.
  const suppressClickRef = useRef(false);

  const cancel = useCallback(() => {
    const state = stateRef.current;
    if (state?.timer) window.clearTimeout(state.timer);
    stateRef.current = null;
    setGhost(null);
    document.documentElement.classList.remove(DRAGGING_CLASS);
  }, []);

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      const state = stateRef.current;
      if (!state || event.pointerId !== state.pointerId) return;
      if (!state.armed) {
        // Still deciding. Travel this far and it was a scroll, not a press.
        if (
          Math.abs(event.clientX - state.startX) > slopPx ||
          Math.abs(event.clientY - state.startY) > slopPx
        ) {
          cancel();
        }
        return;
      }
      setGhost((current) => (current ? { ...current, x: event.clientX, y: event.clientY } : current));
    };

    const handleUp = (event: PointerEvent) => {
      const state = stateRef.current;
      if (!state || event.pointerId !== state.pointerId) return;
      const wasArmed = state.armed;
      const payload = state.payload;
      if (state.timer) window.clearTimeout(state.timer);
      stateRef.current = null;
      setGhost(null);
      if (wasArmed) {
        suppressClickRef.current = true;
        onDrop(payload, { x: event.clientX, y: event.clientY });
      }
      // Only now: the drop reads what is under the finger, and putting the
      // sheet back before that would have it answer "the sheet".
      document.documentElement.classList.remove(DRAGGING_CLASS);
    };

    // Non-passive on purpose: this is the only way to stop the page scrolling
    // under a drag that has already started.
    const blockScroll = (event: TouchEvent) => {
      if (stateRef.current?.armed) event.preventDefault();
    };

    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleUp);
    document.addEventListener('pointercancel', cancel);
    document.addEventListener('touchmove', blockScroll, { passive: false });
    return () => {
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerup', handleUp);
      document.removeEventListener('pointercancel', cancel);
      document.removeEventListener('touchmove', blockScroll);
    };
  }, [cancel, onDrop, slopPx]);

  const bind = useCallback(
    (payload: T): TouchDragBinding => ({
      onPointerDown: (event: React.PointerEvent) => {
        // A mouse keeps the native HTML5 drag, which is richer (drop cursors,
        // the browser's own drag image) and already works.
        if (event.pointerType === 'mouse') return;
        if (stateRef.current) cancel();
        const { clientX, clientY, pointerId } = event;
        const timer = window.setTimeout(() => {
          const state = stateRef.current;
          if (!state) return;
          state.armed = true;
          document.documentElement.classList.add(DRAGGING_CLASS);
          setGhost({ label: payload.label, x: state.startX, y: state.startY });
        }, longPressMs);
        stateRef.current = { payload, pointerId, startX: clientX, startY: clientY, armed: false, timer };
      },
      onClickCapture: (event: React.MouseEvent) => {
        if (!suppressClickRef.current) return;
        suppressClickRef.current = false;
        event.preventDefault();
        event.stopPropagation();
      },
    }),
    [cancel, longPressMs]
  );

  const ghostNode =
    ghost && typeof document !== 'undefined'
      ? createPortal(
          <div
            aria-hidden="true"
            className="pointer-events-none fixed z-[200] -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary bg-card/95 px-3 py-1.5 text-xs font-medium shadow-lg"
            style={{ left: ghost.x, top: ghost.y }}
          >
            {ghost.label}
          </div>,
          document.body
        )
      : null;

  return { bind, ghostNode, isDragging: ghost !== null };
}
