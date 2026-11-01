"use client";

// A tab dragged out of one editor window and let go over another.
//
// No shell hands a pointer drag from one window to another. The window the
// drag started in keeps the pointer for as long as the button is down, even
// outside its own frame, so it is the only one that knows where the pointer
// is, and every other window knows only where it is itself. So as a drag
// starts, the dragging window asks the others where they are (`tab-drag` on
// the tab bus, tabWindows.ts), each answers with its place on the screen
// (`tab-drag-window`), and from then on the dragging window works out which
// one the pointer is over by itself: on every move, and again where the tab
// is let go, which is the only position that decides where it lands. A tab
// let go over another window moves there, the way Move to window does.
//
// The two shells measure the screen differently, each consistently with
// itself:
//
//   web      CSS pixels: a pointer event's screenX and screenY against
//            window.screenX, screenY, outerWidth and outerHeight
//   desktop  physical pixels: Tauri's cursorPosition against the window's
//            outerPosition and outerSize, because on a desk of displays with
//            different scales only physical pixels share an origin (rule 31)

import { isTauri } from '@/lib/desktop';

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function containsPoint(rect: ScreenRect, point: ScreenPoint): boolean {
  return point.x >= rect.left && point.x < rect.right && point.y >= rect.top && point.y < rect.bottom;
}

/** Where this window is on the screen, in the units the drag's points use. Null when it cannot say. */
export async function thisWindowScreenRect(): Promise<ScreenRect | null> {
  if (typeof window === 'undefined') return null;
  if (isTauri()) {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const current = getCurrentWindow();
      if (await current.isMinimized()) return null;
      const [position, size] = await Promise.all([current.outerPosition(), current.outerSize()]);
      return { left: position.x, top: position.y, right: position.x + size.width, bottom: position.y + size.height };
    } catch {
      return null;
    }
  }
  return {
    left: window.screenX,
    top: window.screenY,
    right: window.screenX + window.outerWidth,
    bottom: window.screenY + window.outerHeight,
  };
}

/** Where the pointer of `event` is on the screen. Null when the desktop shell cannot say. */
export async function pointerScreenPoint(event: { screenX: number; screenY: number }): Promise<ScreenPoint | null> {
  if (!isTauri()) return { x: event.screenX, y: event.screenY };
  try {
    const { cursorPosition } = await import('@tauri-apps/api/window');
    const cursor = await cursorPosition();
    return { x: cursor.x, y: cursor.y };
  } catch {
    return null;
  }
}

/** Another window, as it answered a drag: where it is, and when it last had focus. */
export interface DropCandidate {
  windowId: string;
  /** Null while it is minimized or out of sight, when nothing can land on it. */
  rect: ScreenRect | null;
  focusedAt: number;
}

/**
 * The window a tab at `point` would move to: one the point is over, and where
 * windows overlap, the one that had focus last, which is likeliest to be in
 * front. None while the point is over the window the drag started in: it has
 * focus for as long as the drag lasts, so it is in front of anything there.
 */
export function pickDropWindow(
  point: ScreenPoint,
  own: ScreenRect | null,
  candidates: Iterable<DropCandidate>
): string | null {
  if (own && containsPoint(own, point)) return null;
  let best: DropCandidate | null = null;
  for (const candidate of candidates) {
    if (!candidate.rect || !containsPoint(candidate.rect, point)) continue;
    if (!best || candidate.focusedAt > best.focusedAt) best = candidate;
  }
  return best?.windowId ?? null;
}

let focusedAt = 0;
let trackingFocus = false;

/** Start noting when this window has focus. Once, at startup. */
export function trackWindowFocus(): void {
  if (trackingFocus || typeof window === 'undefined') return;
  trackingFocus = true;
  if (document.hasFocus()) focusedAt = Date.now();
  window.addEventListener('focus', () => {
    focusedAt = Date.now();
  });
}

/** When this window last had focus, for telling overlapping windows apart. */
export function windowFocusedAt(): number {
  return focusedAt;
}
