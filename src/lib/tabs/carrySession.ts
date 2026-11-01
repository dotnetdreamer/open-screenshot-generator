"use client";

// Layers carried from one tab into another.
//
// Holding dragged layers over a tab opens that tab (spring loading in
// ProjectTabBar). The drag that picked them up belongs to a DraggableElement
// in the project being left, and that component goes away with its canvas. So
// the layers are lifted first: their DOM is copied into a ghost that follows
// the pointer, the original drag is stopped without committing anything
// (abandonElementCarry), and this module's listeners carry the gesture to its
// end. They listen on window in the capture phase and stop each event there,
// so nothing underneath reacts to a pointer that is busy holding layers.
//
// The ghost is a picture, nothing more. Where the layers land is worked out
// from the pointer and the middle of the set as it was lifted, never from the
// copied DOM.

import type { Point } from '@/types/artboard';
import { abandonElementCarry, cancelElementCarry, moveElementCarry } from './elementCarry';

export type CarryDrop =
  | { kind: 'artboard'; artboardId: string; at: Point; copy: boolean }
  | { kind: 'tab'; projectId: string; copy: boolean }
  | { kind: 'cancel' };

export interface CarrySessionOptions {
  clientX: number;
  clientY: number;
  copy: boolean;
  artboardId: string;
  /** Every layer being carried. */
  elementIds: string[];
  /** The one the drag started on, for the tab strip. */
  elementId: string;
  onEnd(drop: CarryDrop): void;
}

/** Copies what a canvas shows into its clone, which starts blank. */
function copyCanvases(from: HTMLElement, to: HTMLElement): void {
  const sources = from.querySelectorAll('canvas');
  const targets = to.querySelectorAll('canvas');
  sources.forEach((source, index) => {
    const target = targets[index];
    if (!target) return;
    target.width = source.width;
    target.height = source.height;
    try {
      target.getContext('2d')?.drawImage(source, 0, 0);
    } catch {
      // A canvas that cannot be read stays blank in the ghost.
    }
  });
}

/**
 * Lift the layers and carry them until they are put down. Returns a function
 * that ends the carry without a drop, for a caller that goes away first.
 */
export function startCarrySession(options: CarrySessionOptions): () => void {
  const start = { x: options.clientX, y: options.clientY };
  let center: Point = { ...start };

  const ghost = document.createElement('div');
  ghost.setAttribute('data-tab-carry-ghost', '');
  ghost.setAttribute('aria-hidden', 'true');
  // The light palette every artboard surface keeps in dark mode (globals.css).
  ghost.setAttribute('data-artboard-surface', '');
  const board = document.querySelector<HTMLElement>(`[data-artboard-dom-id="${CSS.escape(options.artboardId)}"]`);
  if (board) {
    // The ghost reproduces the board's own coordinate space, so each copied
    // layer keeps the place and the turn it was drawn with.
    const rect = board.getBoundingClientRect();
    const scale = board.offsetWidth > 0 ? rect.width / board.offsetWidth : 1;
    Object.assign(ghost.style, {
      position: 'fixed',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${board.offsetWidth}px`,
      height: `${board.offsetHeight}px`,
      transform: `scale(${scale})`,
      transformOrigin: 'top left',
      pointerEvents: 'none',
      zIndex: '90',
      opacity: '0.85',
    } satisfies Partial<CSSStyleDeclaration>);
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const id of options.elementIds) {
      const node = board.querySelector<HTMLElement>(`[data-element-id="${CSS.escape(id)}"]`);
      if (!node) continue;
      const box = node.getBoundingClientRect();
      left = Math.min(left, box.left);
      top = Math.min(top, box.top);
      right = Math.max(right, box.right);
      bottom = Math.max(bottom, box.bottom);
      const clone = node.cloneNode(true) as HTMLElement;
      copyCanvases(node, clone);
      // The selection outline and the handles are not part of the artwork.
      clone.querySelectorAll('[data-export-exclude]').forEach((chrome) => chrome.remove());
      clone.removeAttribute('data-element-id');
      ghost.appendChild(clone);
    }
    if (left !== Infinity) center = { x: (left + right) / 2, y: (top + bottom) / 2 };
  }
  document.body.appendChild(ghost);

  let ended = false;
  const cleanup = () => {
    if (ended) return;
    ended = true;
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onCancel, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', onCancel);
    ghost.remove();
    cancelElementCarry();
    document.body.style.cursor = '';
  };
  const finish = (drop: CarryDrop) => {
    if (ended) return;
    cleanup();
    options.onEnd(drop);
  };

  const onMove = (event: PointerEvent) => {
    event.stopPropagation();
    event.preventDefault();
    ghost.style.translate = `${event.clientX - start.x}px ${event.clientY - start.y}px`;
    // The strip goes on showing what letting go would do, and opening tabs.
    moveElementCarry({ clientX: event.clientX, clientY: event.clientY, copy: event.altKey, elementId: options.elementId });
  };

  const onUp = (event: PointerEvent) => {
    event.stopPropagation();
    event.preventDefault();
    // The ghost takes no pointer events, so this is what is under it.
    const under = document.elementFromPoint(event.clientX, event.clientY);
    const tab = under?.closest<HTMLElement>('[data-tab-id]');
    if (tab?.dataset.tabId) {
      finish({ kind: 'tab', projectId: tab.dataset.tabId, copy: event.altKey });
      return;
    }
    const target = under?.closest<HTMLElement>('[data-artboard-dom-id]');
    const targetId = target?.dataset.artboardDomId;
    if (target && targetId) {
      const rect = target.getBoundingClientRect();
      const scale = target.offsetWidth > 0 ? rect.width / target.offsetWidth : 1;
      const middle = { x: center.x + event.clientX - start.x, y: center.y + event.clientY - start.y };
      finish({
        kind: 'artboard',
        artboardId: targetId,
        at: { x: (middle.x - rect.left) / scale, y: (middle.y - rect.top) / scale },
        copy: event.altKey,
      });
      return;
    }
    finish({ kind: 'cancel' });
  };

  const onCancel = () => finish({ kind: 'cancel' });
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    event.preventDefault();
    finish({ kind: 'cancel' });
  };

  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', onCancel, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', onCancel);
  document.body.style.cursor = 'grabbing';
  // Lifted, so the drag that picked the layers up can stop, committing nothing.
  abandonElementCarry();
  moveElementCarry({ clientX: start.x, clientY: start.y, copy: options.copy, elementId: options.elementId });

  return cleanup;
}
