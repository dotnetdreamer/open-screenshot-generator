"use client";

// A detached panel window's half of the detach feature.
//
// It holds no project state of its own. It says hello, renders whatever
// snapshot the editor sends, and turns every click into an intent addressed
// back to that editor. Nothing here writes to Dexie, publishes to the cloud, or
// pushes undo, which is the whole point: two windows editing the same document
// through two code paths is how a document ends up in two states.
//
// It does read Dexie, though. Media travels by reference (asset:<id>, mediaId),
// and IndexedDB is shared across every window on the origin, so an image
// preview in a detached properties form resolves its own bytes locally rather
// than being sent them.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DockHandlers } from '@/components/open-screenshot-generator/panels/RightDockPanels';
import { joinPanelBus, PANEL_WINDOW_ID, type PanelBus } from './bus';
import {
  fromWireSnapshot,
  type DockIntent,
  type DockSnapshot,
  type PanelMessage,
} from './protocol';
import { hostIdFromUrl, type DetachablePanel } from './url';

/** How long to wait for a first snapshot before saying the editor is not there. */
const HELLO_TIMEOUT_MS = 5000;

/** Close this window, whichever kind of window it is. */
async function closeSelf(): Promise<void> {
  if (typeof window === 'undefined') return;
  if ('__TAURI_INTERNALS__' in window) {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().close();
      return;
    } catch (error) {
      console.error('Could not close this window', error);
    }
  }
  // A popup may close itself, because a script opened it.
  window.close();
}

export type DockConnection = 'connecting' | 'connected' | 'lost';

export interface DockClient {
  connection: DockConnection;
  snapshot: DockSnapshot | null;
  handlers: DockHandlers;
  /** Ask the editor to take these panels back and close this window. */
  reattach: () => void;
  /** Say hello again. What the "Try again" button does. */
  retry: () => void;
}

export function useDockClient(panels: DetachablePanel[]): DockClient {
  const busRef = useRef<PanelBus | null>(null);
  const hostIdRef = useRef<string | null>(hostIdFromUrl());
  const revRef = useRef(-1);
  const panelsRef = useRef(panels);
  panelsRef.current = panels;

  const [connection, setConnection] = useState<DockConnection>('connecting');
  const [snapshot, setSnapshot] = useState<DockSnapshot | null>(null);

  const sayHello = useCallback(() => {
    setConnection((current) => (current === 'connected' ? current : 'connecting'));
    busRef.current?.post({
      kind: 'hello',
      from: PANEL_WINDOW_ID,
      panels: panelsRef.current,
      hostId: hostIdRef.current,
    });
  }, []);

  useEffect(() => {
    let disposed = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const armTimeout = () => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        setConnection((current) => (current === 'connected' ? current : 'lost'));
      }, HELLO_TIMEOUT_MS);
    };

    const onMessage = (message: PanelMessage) => {
      switch (message.kind) {
        case 'snapshot': {
          if (message.to !== null && message.to !== PANEL_WINDOW_ID) return;
          // The editor that answered is the editor we belong to from now on,
          // which is what lets a panel window survive a reload of the editor.
          hostIdRef.current = message.from;
          // Out of order delivery is possible on the web, where a targeted
          // answer and a broadcast can cross.
          if (message.snapshot.rev <= revRef.current) return;
          revRef.current = message.snapshot.rev;
          if (timeout) clearTimeout(timeout);
          setConnection('connected');
          setSnapshot(fromWireSnapshot(message.snapshot));
          break;
        }
        case 'host-up':
          // A new editor, or the same one after a reload, which is why the id
          // in our URL cannot be trusted for long. Adopt the one that just came
          // up and introduce ourselves, so it knows to feed us.
          hostIdRef.current = message.from;
          revRef.current = -1;
          sayHello();
          armTimeout();
          break;
        case 'host-down':
          if (hostIdRef.current && message.from !== hostIdRef.current) return;
          setConnection('lost');
          break;
        case 'go-home': {
          // The editor wants these panels back. Only the window that holds them
          // should answer, and it answers by leaving.
          const mine = panelsRef.current;
          const forUs =
            message.panels.length === mine.length &&
            mine.every((panel) => message.panels.includes(panel));
          if (forUs) void closeSelf();
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
      sayHello();
      armTimeout();
    });

    return () => {
      disposed = true;
      if (timeout) clearTimeout(timeout);
      busRef.current?.post({ kind: 'bye', from: PANEL_WINDOW_ID });
      busRef.current?.close();
      busRef.current = null;
    };
  }, [sayHello]);

  // Tell the editor we are going. `pagehide` covers the web and a reload; a
  // Tauri window close destroys the webview without firing any unload event, so
  // the desktop shell needs the window's own close hook. Same split as the
  // editor's final project save.
  useEffect(() => {
    const goodbye = () => busRef.current?.post({ kind: 'bye', from: PANEL_WINDOW_ID });
    window.addEventListener('pagehide', goodbye);

    let disposed = false;
    let unlistenClose: (() => void) | undefined;
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      void (async () => {
        try {
          const { getCurrentWindow } = await import('@tauri-apps/api/window');
          const unlisten = await getCurrentWindow().onCloseRequested(() => goodbye());
          if (disposed) unlisten();
          else unlistenClose = unlisten;
        } catch (error) {
          console.error('Could not hook this window close', error);
        }
      })();
    }

    return () => {
      disposed = true;
      window.removeEventListener('pagehide', goodbye);
      unlistenClose?.();
    };
  }, []);

  const send = useCallback((intent: DockIntent) => {
    const to = hostIdRef.current;
    if (!to) return;
    busRef.current?.post({ kind: 'intent', from: PANEL_WINDOW_ID, to, intent });
  }, []);

  /**
   * Go back into the dock.
   *
   * The window closes ITSELF rather than asking the editor to close it. The
   * editor can only close what it can still address, and on the web that is a
   * handle it loses on its own reload; the window is always able to close
   * itself. The message is what tells the editor to put the tabs back.
   */
  const reattach = useCallback(() => {
    busRef.current?.post({
      kind: 'reattach',
      from: PANEL_WINDOW_ID,
      hostId: hostIdRef.current,
      panels: panelsRef.current,
    });
    busRef.current?.post({ kind: 'bye', from: PANEL_WINDOW_ID });
    void closeSelf();
  }, []);

  const handlers = useMemo<DockHandlers>(
    () => ({
      onUpdateElement: (updates) => send({ name: 'updateSelectedElement', updates }),
      onUpdateElementById: (elementId, updates) =>
        send({ name: 'updateElementById', elementId, updates }),
      onTranslateElement: (elementId) => send({ name: 'translateElement', elementId }),
      onUpdateArtboardDetails: (updates, scope) => send({ name: 'updateArtboardDetails', updates, scope }),
      onResetLocaleField: (field) => send({ name: 'resetLocaleField', field }),
      onToggleLocaleDetach: (keys, detach) => send({ name: 'toggleLocaleDetach', keys, detach }),
      onResetLocaleOverrides: (scope) => send({ name: 'resetLocaleOverrides', scope }),
      onJumpToHistory: (index) => send({ name: 'jumpToHistory', index }),
      onSaveNamedVersion: (label) => send({ name: 'saveNamedVersion', label }),
      onRestoreVersion: (version) => send({ name: 'restoreVersion', versionId: version.id }),
      onOpenVersionCopy: (version) => send({ name: 'openVersionCopy', versionId: version.id }),
      onDeleteVersion: (version) => send({ name: 'deleteVersion', versionId: version.id }),
      onSelectElement: (elementId) => send({ name: 'selectElement', elementId }),
      onMoveElementLayer: (elementId, direction) =>
        send({ name: 'moveElementLayer', elementId, direction }),
      onDeleteElement: (elementId) => send({ name: 'deleteElement', elementId }),
      onRenameElement: (elementId, newName) => send({ name: 'renameElement', elementId, newName }),
    }),
    [send]
  );

  return { connection, snapshot, handlers, reattach, retry: sayHello };
}
