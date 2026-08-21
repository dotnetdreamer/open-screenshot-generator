"use client";

// Opening, finding and closing the window a detached panel lives in.
//
// Desktop gets a real OS window (Tauri WebviewWindow, label `panel-<group>`),
// which is the only thing a second monitor can actually receive; a browser gets
// a popup of the same document. Both load `/?panel=...`, both join the bus, and
// from the editor's point of view the two are the same thing.
//
// Geometry is remembered per group in localStorage, written by the panel window
// itself as it is dragged (see useDetachedGeometry). Physical pixels, because
// that is the only coordinate space a mixed-DPI desktop shares.

import { isTauri } from '@/lib/desktop';
import {
  DETACHABLE_PANELS,
  PANEL_GROUP_ALL,
  panelWindowUrl,
  type DetachablePanel,
} from './url';
import { placementOn, type MonitorInfo } from './monitors';

/** One detachable unit: the whole dock, or a single panel torn off on its own. */
export type PanelGroup = typeof PANEL_GROUP_ALL | DetachablePanel;

/** Tauri window label. The `panel-` prefix is what capabilities/panels.json matches. */
export function panelWindowLabel(group: PanelGroup): string {
  return `panel-${group}`;
}

/** Browser popup name. Reusing it is what focuses an already open popup. */
function panelPopupName(group: PanelGroup): string {
  return `osg-panel-${group}`;
}

const GEOMETRY_KEY_PREFIX = 'abs-panel-window-';

/**
 * Where a panel window was, in physical pixels.
 *
 * The OUTER position and the INNER size, because that is the pair the setters
 * accept: `setPosition` is the window's top left on the virtual desktop, and
 * `setSize` is the client area, excluding the title bar and the border. Reading
 * back `outerSize` and feeding it to `setSize` is the classic creep bug, where
 * a window grows by the height of its own title bar every time it reopens.
 */
export interface PanelGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A first-run panel window, in logical pixels. As wide as the docked column. */
const DEFAULT_LOGICAL_WIDTH = 360;
const DEFAULT_LOGICAL_HEIGHT = 820;

export function readPanelGeometry(group: PanelGroup): PanelGeometry | null {
  try {
    const raw = window.localStorage.getItem(GEOMETRY_KEY_PREFIX + group);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PanelGeometry>;
    const values = [parsed.x, parsed.y, parsed.width, parsed.height];
    if (values.some((value) => typeof value !== 'number' || !Number.isFinite(value))) return null;
    if ((parsed.width as number) < 200 || (parsed.height as number) < 200) return null;
    return parsed as PanelGeometry;
  } catch {
    return null;
  }
}

export function writePanelGeometry(group: PanelGroup, geometry: PanelGeometry): void {
  try {
    window.localStorage.setItem(GEOMETRY_KEY_PREFIX + group, JSON.stringify(geometry));
  } catch {}
}

/** Which panels a group shows. `dock` is all four, in tab order. */
export function panelsInGroup(group: PanelGroup): DetachablePanel[] {
  return group === PANEL_GROUP_ALL ? [...DETACHABLE_PANELS] : [group];
}

/** Window title. Reads as a tool window, not as a second copy of the app. */
export function panelWindowTitle(group: PanelGroup, projectName: string): string {
  const what =
    group === PANEL_GROUP_ALL
      ? 'Panels'
      : group.charAt(0).toUpperCase() + group.slice(1);
  return projectName ? `${what} - ${projectName}` : what;
}

/**
 * Is a fully off-screen saved position still usable?
 *
 * A laptop that was docked to two screens yesterday has one today, and a window
 * restored onto the display that is no longer there is a window nobody can
 * reach. So a saved position only counts when some display still overlaps it.
 */
function isOnSomeMonitor(geometry: PanelGeometry, monitors: MonitorInfo[]): boolean {
  if (monitors.length === 0) return true;
  return monitors.some((monitor) => {
    const right = monitor.workArea.x + monitor.workArea.width;
    const bottom = monitor.workArea.y + monitor.workArea.height;
    // 80px of the title bar showing is enough to grab it with.
    return (
      geometry.x + geometry.width - 80 > monitor.workArea.x &&
      geometry.x + 80 < right &&
      geometry.y + 40 > monitor.workArea.y - 1 &&
      geometry.y + 40 < bottom
    );
  });
}

/**
 * Where a panel window should open: the saved spot when it is still on a
 * display, otherwise centred on the display the user picked, otherwise centred
 * on whatever display we know about.
 */
export function resolvePanelGeometry(
  group: PanelGroup,
  monitors: MonitorInfo[],
  preferred: MonitorInfo | null
): PanelGeometry | null {
  const saved = readPanelGeometry(group);
  if (saved && !preferred && isOnSomeMonitor(saved, monitors)) return saved;

  const monitor = preferred ?? monitors.find((candidate) => !candidate.isPrimary) ?? monitors[0];
  if (!monitor) return saved;
  const scale = monitor.scaleFactor || 1;
  return placementOn(monitor, {
    width: Math.round((saved?.width ?? DEFAULT_LOGICAL_WIDTH * scale)),
    height: Math.round((saved?.height ?? DEFAULT_LOGICAL_HEIGHT * scale)),
  });
}

/** Web popups we opened, so a second click focuses one instead of stacking another. */
const popups = new Map<PanelGroup, Window>();

export interface OpenPanelWindowOptions {
  group: PanelGroup;
  hostId: string;
  projectName: string;
  /** Put it on this display. Omit to reuse the remembered position. */
  monitor?: MonitorInfo | null;
  monitors: MonitorInfo[];
}

/**
 * Open the window, or focus it if it is already open.
 *
 * Created hidden and shown only once it has been placed: a window that appears
 * on the primary display and then jumps to the second one reads as a bug, and
 * on Windows the jump also costs a DPI change mid-paint.
 */
export async function openPanelWindow(options: OpenPanelWindowOptions): Promise<boolean> {
  const { group, hostId, projectName, monitor = null, monitors } = options;
  const url = panelWindowUrl(panelsInGroup(group), hostId);
  const geometry = resolvePanelGeometry(group, monitors, monitor);

  if (isTauri()) {
    try {
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      const label = panelWindowLabel(group);
      const existing = await WebviewWindow.getByLabel(label);
      if (existing) {
        if (monitor) {
          const { moveWindowToMonitor } = await import('./monitors');
          await moveWindowToMonitor(label, monitor);
        }
        await existing.show();
        await existing.setFocus();
        return true;
      }

      const created = new WebviewWindow(label, {
        url,
        title: panelWindowTitle(group, projectName),
        width: DEFAULT_LOGICAL_WIDTH,
        height: DEFAULT_LOGICAL_HEIGHT,
        minWidth: 300,
        minHeight: 320,
        resizable: true,
        visible: false,
        // The canvas is the only place a dropped file means anything, and Tauri
        // swallows web drag and drop wherever this is on.
        dragDropEnabled: false,
      });

      await new Promise<void>((resolve, reject) => {
        const settle = (error?: unknown) => (error ? reject(error) : resolve());
        void created.once('tauri://created', () => settle());
        void created.once('tauri://error', (event) => settle(event.payload ?? new Error('window failed')));
      });

      if (geometry) {
        const { PhysicalPosition, PhysicalSize } = await import('@tauri-apps/api/dpi');
        await created.setPosition(new PhysicalPosition(geometry.x, geometry.y));
        await created.setSize(new PhysicalSize(geometry.width, geometry.height));
      }
      await created.show();
      await created.setFocus();
      return true;
    } catch (error) {
      console.error('Could not open the panel window', error);
      return false;
    }
  }

  const open = popups.get(group);
  if (open && !open.closed) {
    open.focus();
    return true;
  }
  const width = geometry?.width ?? DEFAULT_LOGICAL_WIDTH;
  const height = geometry?.height ?? DEFAULT_LOGICAL_HEIGHT;
  const features = [
    'popup=yes',
    `width=${Math.round(width)}`,
    `height=${Math.round(height)}`,
    geometry ? `left=${Math.round(geometry.x)}` : '',
    geometry ? `top=${Math.round(geometry.y)}` : '',
  ]
    .filter(Boolean)
    .join(',');
  const popup = window.open(url, panelPopupName(group), features);
  if (!popup) return false;
  popups.set(group, popup);
  popup.focus();
  return true;
}

/** Bring an already open panel window forward. False when there is none. */
export async function focusPanelWindow(group: PanelGroup): Promise<boolean> {
  if (isTauri()) {
    try {
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      const existing = await WebviewWindow.getByLabel(panelWindowLabel(group));
      if (!existing) return false;
      await existing.show();
      await existing.setFocus();
      return true;
    } catch {
      return false;
    }
  }
  const open = popups.get(group);
  if (!open || open.closed) return false;
  open.focus();
  return true;
}

/** Put a panel back in the dock: close its window. Safe when there is none. */
export async function closePanelWindow(group: PanelGroup): Promise<void> {
  if (isTauri()) {
    try {
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      const existing = await WebviewWindow.getByLabel(panelWindowLabel(group));
      await existing?.close();
    } catch (error) {
      console.error('Could not close the panel window', error);
    }
    return;
  }
  const open = popups.get(group);
  popups.delete(group);
  if (open && !open.closed) open.close();
}

/** Close every panel window. Used when the editor itself goes away. */
export async function closeAllPanelWindows(): Promise<void> {
  const groups: PanelGroup[] = [PANEL_GROUP_ALL, ...DETACHABLE_PANELS];
  await Promise.all(groups.map((group) => closePanelWindow(group)));
}
