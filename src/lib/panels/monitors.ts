"use client";

// Displays, and putting a window on one of them.
//
// Both shells can answer "which screens are there", they just answer with
// different APIs and with different amounts of truth:
//
//   desktop  Tauri's availableMonitors()/currentMonitor()/primaryMonitor(),
//            which are already in core:window:default, so no new permission is
//            needed to READ the list. Moving a window is a different matter and
//            does need core:window:allow-set-position and friends, granted in
//            capabilities/default.json.
//   web      The Window Management API (getScreenDetails). Chromium only, and
//            it prompts the first time, so it is asked for lazily and only when
//            the user actually reaches for a second screen. Without it there is
//            one screen as far as the page is concerned, which is the honest
//            answer rather than a guess.
//
// Everything here is in PHYSICAL pixels, which is what Tauri reports and what
// mixed-DPI setups make unavoidable: a 4K display scaled to 150% and a 1080p
// display side by side have no common logical origin.

import { isTauri } from '@/lib/desktop';

export interface MonitorInfo {
  /** Stable enough to persist: the name, plus where the display sits. */
  id: string;
  /** What the picker shows, e.g. "DELL U2720Q (3840 x 2160)". */
  label: string;
  isPrimary: boolean;
  /** Top left of the display in the virtual desktop, physical pixels. */
  position: { x: number; y: number };
  size: { width: number; height: number };
  /** The display minus its taskbar and menu bar. Where a window belongs. */
  workArea: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
}

/** Placing a window on a chosen display is a desktop capability. */
export function canPlaceWindows(): boolean {
  return isTauri();
}

function monitorId(name: string | null, x: number, y: number): string {
  return `${name?.trim() || 'Display'}@${x},${y}`;
}

function labelFor(name: string | null, width: number, height: number, isPrimary: boolean): string {
  const base = name?.trim() || 'Display';
  const size = `${width} x ${height}`;
  return isPrimary ? `${base} (${size}, primary)` : `${base} (${size})`;
}

/**
 * Every display, in left to right order.
 *
 * Returns a single entry on the web unless the Window Management permission has
 * been granted, and an empty list only when even that fails, which is what the
 * callers treat as "no display picker to offer".
 */
export async function listMonitors(): Promise<MonitorInfo[]> {
  if (isTauri()) {
    try {
      const { availableMonitors, primaryMonitor } = await import('@tauri-apps/api/window');
      const [monitors, primary] = await Promise.all([availableMonitors(), primaryMonitor()]);
      return monitors
        .map((monitor) => {
          const isPrimary =
            !!primary &&
            primary.position.x === monitor.position.x &&
            primary.position.y === monitor.position.y;
          return {
            id: monitorId(monitor.name, monitor.position.x, monitor.position.y),
            label: labelFor(monitor.name, monitor.size.width, monitor.size.height, isPrimary),
            isPrimary,
            position: { x: monitor.position.x, y: monitor.position.y },
            size: { width: monitor.size.width, height: monitor.size.height },
            workArea: {
              x: monitor.workArea.position.x,
              y: monitor.workArea.position.y,
              width: monitor.workArea.size.width,
              height: monitor.workArea.size.height,
            },
            scaleFactor: monitor.scaleFactor,
          } satisfies MonitorInfo;
        })
        .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);
    } catch (error) {
      console.error('Could not read the display list', error);
      return [];
    }
  }

  return listWebScreens();
}

/**
 * The browser's answer.
 *
 * getScreenDetails is the only web API that can see past the screen the page is
 * on. It is gated behind a permission prompt, so this asks for it only when the
 * page already holds it (`permissions.query`) or when the caller has opted in
 * by calling requestWebScreenAccess first.
 */
async function listWebScreens(): Promise<MonitorInfo[]> {
  if (typeof window === 'undefined') return [];
  const details = await getGrantedScreenDetails();
  if (details) {
    return details.screens
      .map((screen, index) => {
        const name = screen.label || `Screen ${index + 1}`;
        return {
          id: monitorId(name, screen.left, screen.top),
          label: labelFor(name, screen.width, screen.height, !!screen.isPrimary),
          isPrimary: !!screen.isPrimary,
          position: { x: screen.left, y: screen.top },
          size: { width: screen.width, height: screen.height },
          workArea: {
            x: screen.availLeft,
            y: screen.availTop,
            width: screen.availWidth,
            height: screen.availHeight,
          },
          scaleFactor: screen.devicePixelRatio || window.devicePixelRatio || 1,
        } satisfies MonitorInfo;
      })
      .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);
  }

  // availLeft/availTop are real everywhere and still missing from lib.dom.
  const screen = window.screen as Screen & { availLeft?: number; availTop?: number };
  if (!screen) return [];
  return [
    {
      id: monitorId('This screen', 0, 0),
      label: labelFor('This screen', screen.width, screen.height, true),
      isPrimary: true,
      position: { x: 0, y: 0 },
      size: { width: screen.width, height: screen.height },
      workArea: {
        x: screen.availLeft ?? 0,
        y: screen.availTop ?? 0,
        width: screen.availWidth,
        height: screen.availHeight,
      },
      scaleFactor: window.devicePixelRatio || 1,
    },
  ];
}

// The Window Management API, typed just enough to use. It is Chromium only and
// not in lib.dom, so the shape is declared here rather than pulled in globally.
interface WebScreenDetailed {
  left: number;
  top: number;
  width: number;
  height: number;
  availLeft: number;
  availTop: number;
  availWidth: number;
  availHeight: number;
  label?: string;
  isPrimary?: boolean;
  devicePixelRatio?: number;
}
interface WebScreenDetails {
  screens: WebScreenDetailed[];
}

function screenDetailsApi(): (() => Promise<WebScreenDetails>) | null {
  const fn = (window as unknown as { getScreenDetails?: () => Promise<WebScreenDetails> })
    .getScreenDetails;
  return typeof fn === 'function' ? fn.bind(window) : null;
}

/** Only reads the screen list when the permission is ALREADY granted. */
async function getGrantedScreenDetails(): Promise<WebScreenDetails | null> {
  const api = screenDetailsApi();
  if (!api) return null;
  try {
    const status = await navigator.permissions?.query({
      name: 'window-management' as PermissionName,
    });
    if (status && status.state !== 'granted') return null;
    return await api();
  } catch {
    return null;
  }
}

/**
 * Ask the browser for the screen list, prompting if it has to.
 *
 * Called straight from a click, because the prompt needs a user gesture.
 * Returns false when the browser has no such API, which is what makes the
 * caller fall back to a plain popup the user drags themselves.
 */
export async function requestWebScreenAccess(): Promise<boolean> {
  const api = screenDetailsApi();
  if (!api) return false;
  try {
    await api();
    return true;
  } catch {
    return false;
  }
}

/** Where a window of this size sits, centred on a display and inside its work area. */
export function placementOn(
  monitor: MonitorInfo,
  size: { width: number; height: number }
): { x: number; y: number; width: number; height: number } {
  const width = Math.min(Math.round(size.width), monitor.workArea.width);
  const height = Math.min(Math.round(size.height), monitor.workArea.height);
  return {
    width,
    height,
    x: monitor.workArea.x + Math.round((monitor.workArea.width - width) / 2),
    y: monitor.workArea.y + Math.round((monitor.workArea.height - height) / 2),
  };
}

/**
 * Move a window onto a display, keeping its size where the display has room.
 *
 * Position first, then size, because Windows fires a DPI change on the way over
 * and resizes the window itself; setting the size afterwards is what stops a
 * window shrinking every time it crosses from a 100% display to a 150% one.
 *
 * Both measures are read, because they are not the same measure: `setSize` sets
 * the CLIENT area, while whether a window fits on a display is a question about
 * its OUTER rectangle, title bar and border included. Resizing at all is the
 * exception rather than the rule, so a window that already fits is only moved,
 * and one that does not has its client area shrunk by exactly the overflow.
 */
export async function moveWindowToMonitor(label: string, monitor: MonitorInfo): Promise<void> {
  if (!isTauri()) return;
  const { PhysicalPosition, PhysicalSize } = await import('@tauri-apps/api/dpi');
  const { Window } = await import('@tauri-apps/api/window');
  const target = await Window.getByLabel(label);
  if (!target) return;
  if (await target.isMaximized()) await target.unmaximize();

  const [outer, inner] = await Promise.all([target.outerSize(), target.innerSize()]);
  const place = placementOn(monitor, { width: outer.width, height: outer.height });
  await target.setPosition(new PhysicalPosition(place.x, place.y));

  const shrinkX = outer.width - place.width;
  const shrinkY = outer.height - place.height;
  if (shrinkX > 0 || shrinkY > 0) {
    await target.setSize(
      new PhysicalSize(
        Math.max(200, inner.width - shrinkX),
        Math.max(200, inner.height - shrinkY)
      )
    );
  }
  await target.setFocus();
}

/**
 * The display a window is currently on, matched back into the list.
 *
 * There is no per-window currentMonitor() in the API (the free function only
 * ever answers for the calling window), so this asks which display holds the
 * window's centre instead, which is also the answer a half-dragged window
 * should give.
 */
export async function monitorOfWindow(
  label: string,
  monitors: MonitorInfo[]
): Promise<MonitorInfo | null> {
  if (!isTauri() || monitors.length === 0) return null;
  try {
    const { Window, monitorFromPoint } = await import('@tauri-apps/api/window');
    const target = await Window.getByLabel(label);
    if (!target) return null;
    const [position, size] = await Promise.all([target.outerPosition(), target.outerSize()]);
    const monitor = await monitorFromPoint(
      position.x + size.width / 2,
      position.y + size.height / 2
    );
    if (!monitor) return null;
    const id = monitorId(monitor.name, monitor.position.x, monitor.position.y);
    return monitors.find((candidate) => candidate.id === id) ?? null;
  } catch {
    return null;
  }
}
