"use client";

// Editor windows, and what they tell each other about tabs.
//
// A tab can leave its window for a new one, on this display or another. The new
// window is a whole editor: same bundle, same route, opened on the project with
// `?tabwindow=<key>` added. The key does two jobs. It names the window's own
// tab session, because a browser popup starts with a COPY of its opener's
// sessionStorage and would otherwise reopen every tab of the window it came
// from; and it marks the window as secondary, which keeps it out of what only
// one window may run (the MCP bridge, the coding agents) and out of the "what
// was open last time" restore.
//
// Desktop gets a real Tauri window labelled `editor-<key>` (capabilities/
// default.json matches `editor-*`); a browser gets a popup.

import { isTauri } from '@/lib/desktop';
import { joinWindowBus, type WindowBus } from '@/lib/panels/bus';
import { placementOn, type MonitorInfo } from '@/lib/panels/monitors';
import { EDITOR_WINDOW_ID } from './presence';
import type { ScreenRect } from './tabDrag';

export const TAB_WINDOW_PARAM = 'tabwindow';

/** This window's key when it was opened for a tab, else null. */
export function tabWindowKey(): string | null {
  if (typeof window === 'undefined') return null;
  const value = new URLSearchParams(window.location.search).get(TAB_WINDOW_PARAM);
  return value && /^[a-z0-9]{4,24}$/i.test(value) ? value : null;
}

// --- the bus ---------------------------------------------------------------

export type TabWindowMessage =
  /** Who else is there? Each editor window answers with `here`. */
  | { type: 'roll-call'; from: string }
  /** `main` is a window no tab was moved into: the one the app opened with. */
  | { type: 'here'; from: string; to: string; title: string; tabs: number; main: boolean }
  /** Bring the project's tab to the front, and its window. */
  | { type: 'show-project'; from: string; projectId: string }
  /** Let go of the project, so the window asking can open it. */
  | { type: 'hand-over'; from: string; projectId: string; requestId: string }
  | { type: 'handed-over'; from: string; to: string; projectId: string; requestId: string }
  /** Open this project in a tab of yours: it is moving to your window. */
  | { type: 'adopt'; from: string; to: string; projectId: string; name: string }
  /**
   * A tab of the sender's is being dragged out of its strip (tabDrag.ts).
   * `start` asks the other windows where they are, `over` names the window it
   * would land in if let go now (null for none), and `end` says it was let go
   * or put back.
   */
  | {
      type: 'tab-drag';
      from: string;
      projectId: string;
      name: string;
      phase: 'start' | 'over' | 'end';
      target: string | null;
    }
  /** The answer to `start`: where the answering window is on the screen, null when out of sight. */
  | {
      type: 'tab-drag-window';
      from: string;
      to: string;
      projectId: string;
      rect: ScreenRect | null;
      focusedAt: number;
      title: string;
      main: boolean;
    };

const TAURI_EVENT = 'abs-tabs-bus';
const WEB_CHANNEL = 'abs-tabs-bus';

export function joinTabWindowBus(
  onMessage: (message: TabWindowMessage) => void
): Promise<WindowBus<TabWindowMessage>> {
  return joinWindowBus<TabWindowMessage>(TAURI_EVENT, WEB_CHANNEL, EDITOR_WINDOW_ID, onMessage);
}

// --- opening one -----------------------------------------------------------

export interface TabWindowPlacement {
  /** Where a tab dragged out of the strip was let go, in screen CSS pixels. */
  screen?: { x: number; y: number };
  /** A display picked from the list. */
  monitor?: MonitorInfo | null;
}

/** A new window's size, in logical pixels: roomy, and inside the editor's minimum. */
const WINDOW_WIDTH = 1280;
const WINDOW_HEIGHT = 820;
/** Where the window sits under the pointer: its tab strip, a little in from the corner. */
const GRAB_OFFSET = { x: 140, y: 18 };

function newKey(): string {
  return Math.random().toString(36).slice(2, 12);
}

function windowUrl(projectId: string, key: string): string {
  const base = typeof window === 'undefined' ? '/' : window.location.pathname;
  return `${base}?projectId=${encodeURIComponent(projectId)}&${TAB_WINDOW_PARAM}=${key}`;
}

/**
 * Open a window on a project.
 *
 * On the web this has to run inside the click or the release that asked for
 * it, with nothing awaited first, or the popup blocker takes the window: the
 * popup is opened before this returns. Resolves false when no window opened.
 */
export function openTabWindow(projectId: string, title: string, placement: TabWindowPlacement): Promise<boolean> {
  const key = newKey();
  const url = windowUrl(projectId, key);
  if (isTauri()) return openDesktopWindow(key, url, title, placement);

  let left: number | undefined;
  let top: number | undefined;
  if (placement.monitor) {
    const place = placementOn(placement.monitor, { width: WINDOW_WIDTH, height: WINDOW_HEIGHT });
    left = place.x;
    top = place.y;
  } else if (placement.screen) {
    left = Math.round(placement.screen.x - GRAB_OFFSET.x);
    top = Math.round(placement.screen.y - GRAB_OFFSET.y);
  }
  const features = [
    'popup=yes',
    `width=${WINDOW_WIDTH}`,
    `height=${WINDOW_HEIGHT}`,
    left !== undefined ? `left=${left}` : '',
    top !== undefined ? `top=${top}` : '',
  ]
    .filter(Boolean)
    .join(',');
  const opened = window.open(url, `osg-editor-${key}`, features);
  return Promise.resolve(!!opened);
}

async function openDesktopWindow(
  key: string,
  url: string,
  title: string,
  placement: TabWindowPlacement
): Promise<boolean> {
  try {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    const label = `editor-${key}`;
    const created = new WebviewWindow(label, {
      url,
      title: title ? `${title} - Open Screenshot Generator` : 'Open Screenshot Generator',
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
      minWidth: 1024,
      minHeight: 680,
      resizable: true,
      // Shown once it is where it belongs, so it never flashes on the wrong display.
      visible: false,
      // The canvas takes dropped files itself; Tauri's own handler would swallow them.
      dragDropEnabled: false,
    });
    await new Promise<void>((resolve, reject) => {
      void created.once('tauri://created', () => resolve());
      void created.once('tauri://error', (event) => reject(event.payload ?? new Error('window failed')));
    });
    if (placement.monitor) {
      const { moveWindowToMonitor } = await import('@/lib/panels/monitors');
      await moveWindowToMonitor(label, placement.monitor);
    } else if (placement.screen) {
      // The pointer's own position, in physical pixels: the one coordinate
      // space a desk of mixed-DPI displays shares (rule 31).
      const { cursorPosition } = await import('@tauri-apps/api/window');
      const { PhysicalPosition } = await import('@tauri-apps/api/dpi');
      const cursor = await cursorPosition();
      const scale = await created.scaleFactor();
      await created.setPosition(
        new PhysicalPosition(Math.round(cursor.x - GRAB_OFFSET.x * scale), Math.round(cursor.y - GRAB_OFFSET.y * scale))
      );
    }
    await created.show();
    await created.setFocus();
    return true;
  } catch (error) {
    console.error('Could not open a window for the tab', error);
    return false;
  }
}

/** Bring this window to the front, as far as the shell allows. */
export async function focusThisWindow(): Promise<void> {
  if (isTauri()) {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const current = getCurrentWindow();
      if (await current.isMinimized()) await current.unminimize();
      await current.setFocus();
    } catch {
      // A window that may not focus itself stays where it is.
    }
    return;
  }
  // Browsers honour this for a popup and mostly ignore it for a tab; the tab
  // still comes forward in its own strip.
  window.focus();
}

/** Close this window: the last tab of a secondary window left it. */
export async function closeThisWindow(): Promise<void> {
  if (isTauri()) {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().close();
    } catch (error) {
      console.error('Could not close the window', error);
    }
    return;
  }
  window.close();
}
