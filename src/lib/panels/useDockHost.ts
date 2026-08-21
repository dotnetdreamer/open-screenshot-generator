"use client";

// The editor's half of the detach feature.
//
// It publishes what the dock shows and replays what a detached window asks for.
// The editor stays the only writer: an intent arriving here is handed to the
// very same handler the docked panel would have called, so handleArtboardsUpdate
// is still the only door and undo still records one entry per edit whichever
// window the click came from.
//
// Publishing is trailing-throttled rather than fired per render. A slider in a
// detached properties form commits once, but a canvas drag commits per pixel,
// and every one of those is a snapshot; at 60Hz over IPC that is the kind of
// traffic that makes a second window feel worse than no second window.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DockHandlers } from '@/components/open-screenshot-generator/panels/RightDockPanels';
import { joinPanelBus, PANEL_WINDOW_ID, type PanelBus } from './bus';
import {
  toWireSnapshot,
  type DockData,
  type DockIntent,
  type PanelMessage,
  type RightDockTab,
} from './protocol';
import { DETACHABLE_PANELS, PANEL_GROUP_ALL, type DetachablePanel } from './url';
import {
  closeAllPanelWindows,
  closePanelWindow,
  focusPanelWindow,
  openPanelWindow,
  panelsInGroup,
  type PanelGroup,
} from './windows';
import { listMonitors, requestWebScreenAccess, type MonitorInfo } from './monitors';
import { isTauri } from '@/lib/desktop';

/** Which window a set of panels came from. The whole dock, or one panel. */
function groupOf(panels: DetachablePanel[]): PanelGroup {
  return panels.length === DETACHABLE_PANELS.length
    ? PANEL_GROUP_ALL
    : (panels[0] ?? PANEL_GROUP_ALL);
}

/**
 * How long a group is given to come back before its panels return to the dock.
 *
 * Closing a panel window and reloading one look identical from here: both send
 * a `bye`. A reload says `hello` again within a moment, so waiting tells them
 * apart without a flag that the web could not set honestly anyway (nothing in a
 * browser distinguishes a reload from a close inside `pagehide`).
 */
const RECLAIM_GRACE_MS = 1500;

/** How long two publishes are held apart. One frame is too eager, a tenth of a
 *  second is still invisible to the eye and cuts a canvas drag to a trickle. */
const PUBLISH_INTERVAL_MS = 90;

export interface DockHostOptions {
  /** Everything the panels render, live. Memoize it or this publishes per render. */
  data: DockData;
  /** The editor's own handlers, the ones the docked panels already call. */
  handlers: DockHandlers;
  /** Named in the detached window's title bar. */
  projectName: string;
  /** A detached window asked for a different tab. Keeps the two in step. */
  onSelectTab: (tab: RightDockTab) => void;
}

export interface DockHost {
  /** Groups with a window open right now. */
  detachedGroups: PanelGroup[];
  /** Panels that are showing somewhere else, so the dock must not show them. */
  detachedPanels: DetachablePanel[];
  /** Displays to offer. Empty when there is nothing to choose between. */
  monitors: MonitorInfo[];
  /** True once a panel window exists, which is what the dock's chrome reacts to. */
  hasDetached: boolean;
  /** False when the window could not be opened, e.g. a blocked popup. */
  detach: (group: PanelGroup, monitor?: MonitorInfo | null) => Promise<boolean>;
  /**
   * True once this page may see the other displays. Always true on the desktop;
   * on the web it prompts, so call it from a click.
   */
  requestDisplayAccess: () => Promise<boolean>;
  /** The browser could show more displays if asked. False on the desktop. */
  canAskForDisplays: boolean;
  reattach: (group: PanelGroup) => Promise<void>;
  focus: (group: PanelGroup) => Promise<void>;
  /** Re-read the display list, e.g. when a menu opens. */
  refreshMonitors: () => Promise<MonitorInfo[]>;
}

export function useDockHost(options: DockHostOptions): DockHost {
  const { data, handlers, projectName, onSelectTab } = options;

  const busRef = useRef<PanelBus | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const onSelectTabRef = useRef(onSelectTab);
  onSelectTabRef.current = onSelectTab;

  const revRef = useRef(0);
  const publishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPublishRef = useRef(0);

  /** Panel windows that have said hello, keyed by their bus id. */
  const [clients, setClients] = useState<Record<string, DetachablePanel[]>>({});
  const clientsRef = useRef(clients);
  clientsRef.current = clients;

  /** Groups we opened. Tracked separately: a window exists before it says hello. */
  const [detachedGroups, setDetachedGroups] = useState<PanelGroup[]>([]);
  /** Groups whose window has gone quiet, waiting out RECLAIM_GRACE_MS. */
  const reclaimTimersRef = useRef(new Map<PanelGroup, ReturnType<typeof setTimeout>>());
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);

  const publishTo = useCallback((to: string | null) => {
    const bus = busRef.current;
    if (!bus) return;
    revRef.current += 1;
    lastPublishRef.current = Date.now();
    bus.post({
      kind: 'snapshot',
      from: PANEL_WINDOW_ID,
      to,
      snapshot: toWireSnapshot(dataRef.current, revRef.current),
    });
  }, []);

  const dispatch = useCallback((intent: DockIntent) => {
    const h = handlersRef.current;
    const versionById = (id: string) =>
      dataRef.current.versions.find((version) => version.id === id) ?? null;
    switch (intent.name) {
      case 'updateSelectedElement':
        h.onUpdateElement(intent.updates);
        break;
      case 'updateElementById':
        h.onUpdateElementById(intent.elementId, intent.updates);
        break;
      case 'translateElement':
        h.onTranslateElement(intent.elementId);
        break;
      case 'updateArtboardDetails': {
        // The board travels without its elements or its override map (see
        // slimArtboard), so neither key may ever come back: writing the elided
        // copy home would empty the board. Nothing in the properties form sends
        // them today, and this is what keeps that true.
        const { elements: _elements, localized: _localized, ...safe } = intent.updates;
        h.onUpdateArtboardDetails(safe);
        break;
      }
      case 'resetLocaleField':
        h.onResetLocaleField(intent.field);
        break;
      case 'toggleLocaleDetach':
        h.onToggleLocaleDetach(intent.keys, intent.detach);
        break;
      case 'resetLocaleOverrides':
        h.onResetLocaleOverrides(intent.scope);
        break;
      case 'jumpToHistory':
        h.onJumpToHistory(intent.index);
        break;
      case 'saveNamedVersion':
        h.onSaveNamedVersion(intent.label);
        break;
      // The intent carries an id, not a row: the row holds a Date and a byte
      // count, and the editor already has the authoritative copy of both.
      case 'restoreVersion': {
        const version = versionById(intent.versionId);
        if (version) h.onRestoreVersion(version);
        break;
      }
      case 'openVersionCopy': {
        const version = versionById(intent.versionId);
        if (version) h.onOpenVersionCopy(version);
        break;
      }
      case 'deleteVersion': {
        const version = versionById(intent.versionId);
        if (version) h.onDeleteVersion(version);
        break;
      }
      case 'selectElement':
        h.onSelectElement(intent.elementId);
        break;
      case 'moveElementLayer':
        h.onMoveElementLayer(intent.elementId, intent.direction);
        break;
      case 'deleteElement':
        h.onDeleteElement(intent.elementId);
        break;
      case 'renameElement':
        h.onRenameElement(intent.elementId, intent.newName);
        break;
      case 'selectTab':
        onSelectTabRef.current(intent.tab);
        break;
    }
  }, []);

  // --- the bus ------------------------------------------------------------
  useEffect(() => {
    let disposed = false;
    const onMessage = (message: PanelMessage) => {
      switch (message.kind) {
        case 'hello': {
          // It came back. If it was a reload rather than a close, this is what
          // stops the dock reclaiming its panels behind its back.
          const pending = reclaimTimersRef.current.get(groupOf(message.panels));
          if (pending) {
            clearTimeout(pending);
            reclaimTimersRef.current.delete(groupOf(message.panels));
          }
          // Only answer a window that says it belongs to us. Two editor tabs on
          // the web share one BroadcastChannel, and each must feed its own.
          if (message.hostId && message.hostId !== PANEL_WINDOW_ID) return;
          setClients((current) => ({ ...current, [message.from]: message.panels }));
          // A panel window outlives a reload of the editor, and the reloaded
          // editor starts with an empty detachedGroups. Without this the dock
          // would render Properties while the panel window is also rendering
          // it, and an edit in one would fight the other.
          const group = groupOf(message.panels);
          setDetachedGroups((current) =>
            current.includes(group) ? current : [...current, group]
          );
          publishTo(message.from);
          break;
        }
        case 'bye': {
          // Closing the window IS putting the panels back. Somebody who reaches
          // for the X is asking for the same thing as somebody who reaches for
          // "Put back", and a dock left showing an empty rail for a window that
          // no longer exists is a dead end.
          const panels = clientsRef.current[message.from];
          setClients((current) => {
            if (!(message.from in current)) return current;
            const next = { ...current };
            delete next[message.from];
            return next;
          });
          if (!panels) break;
          const group = groupOf(panels);
          const timers = reclaimTimersRef.current;
          clearTimeout(timers.get(group));
          timers.set(
            group,
            setTimeout(() => {
              timers.delete(group);
              setDetachedGroups((current) => current.filter((candidate) => candidate !== group));
            }, RECLAIM_GRACE_MS)
          );
          break;
        }
        case 'intent':
          if (message.to !== PANEL_WINDOW_ID) return;
          dispatch(message.intent);
          break;
        case 'reattach': {
          if (message.hostId && message.hostId !== PANEL_WINDOW_ID) return;
          // No close call here: the window is already closing itself, which is
          // the only way that works for a popup opened before an editor reload.
          // Its `bye` clears it from `clients`.
          const group = groupOf(message.panels);
          setDetachedGroups((current) => current.filter((candidate) => candidate !== group));
          break;
        }
        default:
          break;
      }
    };

    void joinPanelBus(onMessage).then((bus) => {
      if (disposed) {
        bus.close();
        return;
      }
      busRef.current = bus;
      // A panel window that outlived a reload of the editor is still out there
      // waiting. Announcing the new host id gets it to say hello again.
      bus.post({ kind: 'host-up', from: PANEL_WINDOW_ID });
    });

    const timers = reclaimTimersRef.current;
    return () => {
      disposed = true;
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
      busRef.current?.close();
      busRef.current = null;
    };
  }, [dispatch, publishTo]);

  // --- publishing ---------------------------------------------------------
  const hasClients = Object.keys(clients).length > 0;
  useEffect(() => {
    if (!hasClients || !busRef.current) return;
    // An export has a converted board list on the canvas and every derived
    // value in the snapshot follows it. Hold, and let the publish that fires
    // when isExporting clears carry the real project across.
    if (data.isExporting) return;
    const since = Date.now() - lastPublishRef.current;
    const wait = Math.max(0, PUBLISH_INTERVAL_MS - since);
    if (publishTimerRef.current) clearTimeout(publishTimerRef.current);
    publishTimerRef.current = setTimeout(() => {
      publishTimerRef.current = null;
      publishTo(null);
    }, wait);
    return () => {
      if (publishTimerRef.current) {
        clearTimeout(publishTimerRef.current);
        publishTimerRef.current = null;
      }
    };
  }, [data, hasClients, publishTo]);

  // --- teardown -----------------------------------------------------------
  // A detached window is a view of THIS editor, so it must not outlive it. On
  // desktop the Rust side closes the panel windows when main goes (a Tauri
  // close destroys the webview without firing any unload event), and this is
  // the web half plus the belt and braces for a same-session reload.
  useEffect(() => {
    const goodbye = () => {
      busRef.current?.post({ kind: 'host-down', from: PANEL_WINDOW_ID });
      if (!isTauri()) void closeAllPanelWindows();
    };
    window.addEventListener('pagehide', goodbye);
    return () => window.removeEventListener('pagehide', goodbye);
  }, []);

  const refreshMonitors = useCallback(async () => {
    const list = await listMonitors();
    setMonitors(list);
    return list;
  }, []);

  useEffect(() => {
    void refreshMonitors();
  }, [refreshMonitors]);

  /**
   * Open a group in a window of its own.
   *
   * Nothing may be awaited before the window is opened. On the web this runs
   * inside the click that asked for it, and `window.open` only counts as
   * user-initiated while that gesture is still on the stack; one `await` in
   * front of it and the popup blocker takes it. Which is why asking the browser
   * for the screen list lives in `requestDisplayAccess`, on its own control,
   * rather than here.
   *
   * Returns false when the window could not be opened, which on the web means a
   * blocked popup and is worth telling the user about.
   */
  const detach = useCallback(
    async (group: PanelGroup, monitor: MonitorInfo | null = null) => {
      const opened = await openPanelWindow({
        group,
        hostId: PANEL_WINDOW_ID,
        projectName,
        monitor,
        monitors,
      });
      if (!opened) return false;
      setDetachedGroups((current) =>
        current.includes(group) ? current : [...current, group]
      );
      return true;
    },
    [monitors, projectName]
  );

  /**
   * Ask the browser to let this page see the other displays.
   *
   * Chromium only, and permission prompted, so it is a control the user reaches
   * for rather than something that happens to them. Desktop needs nothing: the
   * display list is already readable there.
   */
  const requestDisplayAccess = useCallback(async () => {
    if (isTauri()) return true;
    const granted = await requestWebScreenAccess();
    if (granted) await refreshMonitors();
    return granted;
  }, [refreshMonitors]);

  /**
   * Take a group back into the dock.
   *
   * Both halves, because either can be the one that works. The message reaches
   * a window this editor cannot address any more (a web popup opened before its
   * own reload); the close reaches a window that has stopped answering.
   */
  const reattach = useCallback(async (group: PanelGroup) => {
    busRef.current?.post({
      kind: 'go-home',
      from: PANEL_WINDOW_ID,
      panels: panelsInGroup(group),
    });
    setDetachedGroups((current) => current.filter((candidate) => candidate !== group));
    setClients((current) => {
      const next: Record<string, DetachablePanel[]> = {};
      for (const [id, panels] of Object.entries(current)) {
        if (groupOf(panels) !== group) next[id] = panels;
      }
      return next;
    });
    await closePanelWindow(group);
  }, []);

  const focus = useCallback(
    async (group: PanelGroup) => {
      const found = await focusPanelWindow(group);
      // The window went away without saying goodbye (a crash, or a close the
      // panel could not report). Stop pretending it is out there.
      if (!found) setDetachedGroups((current) => current.filter((candidate) => candidate !== group));
    },
    []
  );

  // The union of what this editor opened and what has introduced itself. The
  // second half is what covers a panel window that survived an editor reload.
  const detachedPanels = useMemo(() => {
    const set = new Set<DetachablePanel>();
    for (const group of detachedGroups) {
      for (const panel of panelsInGroup(group)) set.add(panel);
    }
    for (const panels of Object.values(clients)) {
      for (const panel of panels) set.add(panel);
    }
    return DETACHABLE_PANELS.filter((panel) => set.has(panel));
  }, [detachedGroups, clients]);

  return {
    detachedGroups,
    detachedPanels,
    monitors,
    hasDetached: detachedGroups.length > 0,
    detach,
    requestDisplayAccess,
    canAskForDisplays:
      !isTauri() &&
      monitors.length < 2 &&
      typeof window !== 'undefined' &&
      'getScreenDetails' in window,
    reattach,
    focus,
    refreshMonitors,
  };
}
