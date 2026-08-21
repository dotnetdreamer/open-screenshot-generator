"use client";

// What a detached panel window renders.
//
// The same bundle as the editor, loaded at `/?panel=...`, but this branch never
// mounts the studio: no canvas, no project loading, no auto save, no MCP
// server, no live session. It is a view of the editor's dock and nothing else,
// which is what keeps two windows from becoming two writers.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Loader2Icon,
  MonitorIcon,
  MoreHorizontalIcon,
  PanelRightCloseIcon,
  RefreshCwIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { LAYERS_SECTION_MIN, RightDockPanels } from './RightDockPanels';
import { MonitorMenuItems } from './MonitorMenuItems';
import { useDockClient } from '@/lib/panels/useDockClient';
import { useDetachedGeometry } from '@/lib/panels/useDetachedGeometry';
import { listMonitors, monitorOfWindow, moveWindowToMonitor, type MonitorInfo } from '@/lib/panels/monitors';
import { panelsFromUrl } from '@/lib/panels/url';
import { panelWindowLabel, panelWindowTitle, type PanelGroup } from '@/lib/panels/windows';
import { DETACHABLE_PANELS, PANEL_GROUP_ALL } from '@/lib/panels/url';
import type { RightDockTab } from '@/lib/panels/protocol';
import { preloadGoogleFonts } from '@/services/fontService';
import { loadCustomFonts } from '@/services/customFonts';

const TAB_KEY_PREFIX = 'abs-panel-window-tab-';
/** This window's own layers split. Never the dock's, see RightDockPanels. */
const SPLIT_KEY_PREFIX = 'abs-panel-window-split-';

export function DetachedPanelsWindow() {
  // Read once: the URL never changes for the life of a panel window, and
  // re-reading it on every render would make every child re-render with it.
  const panels = useMemo(() => panelsFromUrl(), []);
  const group: PanelGroup = useMemo(
    () => (panels.length === DETACHABLE_PANELS.length ? PANEL_GROUP_ALL : (panels[0] ?? PANEL_GROUP_ALL)),
    [panels]
  );

  const { connection, snapshot, handlers, reattach, retry } = useDockClient(panels);
  useDetachedGeometry(group);

  const [tab, setTab] = useState<RightDockTab>('properties');
  const [layersHeight, setLayersHeight] = useState(260);
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [currentMonitorId, setCurrentMonitorId] = useState<string | null>(null);
  const lastTabToken = useRef<number>(-1);

  // The panel window draws text in whatever face the design uses, and the font
  // picker lists the faces the user imported, so it loads both the way the
  // editor does. Both are idempotent and both read the shared IndexedDB.
  useEffect(() => {
    preloadGoogleFonts();
    loadCustomFonts().catch((error) => console.error('Could not load imported fonts', error));
  }, []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(TAB_KEY_PREFIX + group);
      if (stored === 'properties' || stored === 'history' || stored === 'versions') setTab(stored);
      const height = parseInt(window.localStorage.getItem(SPLIT_KEY_PREFIX + group) ?? '', 10);
      if (Number.isFinite(height)) {
        setLayersHeight(Math.max(LAYERS_SECTION_MIN, Math.min(1400, height)));
      }
    } catch {}
  }, [group]);

  const selectTab = useCallback(
    (next: RightDockTab) => {
      setTab(next);
      try {
        window.localStorage.setItem(TAB_KEY_PREFIX + group, next);
      } catch {}
    },
    [group]
  );

  // The editor pointing at a panel, e.g. after saving a version.
  useEffect(() => {
    const request = snapshot?.tabRequest;
    if (!request || request.token === lastTabToken.current) return;
    lastTabToken.current = request.token;
    if (panels.includes(request.tab)) selectTab(request.tab);
  }, [snapshot?.tabRequest, panels, selectTab]);

  const refreshMonitors = useCallback(async () => {
    const list = await listMonitors();
    setMonitors(list);
    setCurrentMonitorId((await monitorOfWindow(panelWindowLabel(group), list))?.id ?? null);
  }, [group]);

  useEffect(() => {
    void refreshMonitors();
  }, [refreshMonitors]);

  const title = snapshot?.projectName?.trim() || 'Open Screenshot Generator';

  // The OS window title is set once, when the window is created, from whatever
  // the project was called then. Rename the project or open a different one and
  // the taskbar entry is a lie, which matters more here than in the editor:
  // finding this window in a task switcher is how a person gets back to it.
  useEffect(() => {
    const name = panelWindowTitle(group, snapshot?.projectName ?? '');
    document.title = name;
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
    void (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().setTitle(name);
      } catch (error) {
        console.error('Could not rename this window', error);
      }
    })();
  }, [group, snapshot?.projectName]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-card text-foreground">
      {/* A thin strip rather than a second app toolbar: this window is one tool
          window, and everything it can do is on it. */}
      <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-b px-2">
        <span className="min-w-0 truncate text-xs text-muted-foreground" title={title}>
          {title}
        </span>
        <div className="flex shrink-0 items-center gap-0.5">
          <DropdownMenu onOpenChange={(open) => open && void refreshMonitors()}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                title="Window options"
                aria-label="Window options"
              >
                <MoreHorizontalIcon className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem onSelect={() => reattach()} className="gap-2">
                <PanelRightCloseIcon className="h-4 w-4 text-muted-foreground" />
                Put back in the editor
              </DropdownMenuItem>
              {monitors.length < 2 && (
                <DropdownMenuItem disabled className="gap-2">
                  <MonitorIcon className="h-4 w-4 text-muted-foreground" />
                  Only one display found
                </DropdownMenuItem>
              )}
              <MonitorMenuItems
                monitors={monitors}
                currentId={currentMonitorId}
                onPick={(monitor) => {
                  void moveWindowToMonitor(panelWindowLabel(group), monitor).then(refreshMonitors);
                }}
              />
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => reattach()}
            title="Put back in the editor"
            aria-label="Put back in the editor"
          >
            <PanelRightCloseIcon className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {snapshot ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {connection === 'lost' && (
            <div className="shrink-0 border-b bg-amber-500/10 px-3 py-1.5 text-[11px] leading-snug text-amber-700 dark:text-amber-400">
              The editor window is not answering. What you see here is the last thing it sent.
            </div>
          )}
          <RightDockPanels
            data={snapshot}
            handlers={handlers}
            panels={panels}
            tab={tab}
            onTabChange={selectTab}
            layersHeight={layersHeight}
            onLayersHeightChange={setLayersHeight}
            onLayersHeightCommit={(height) => {
              try {
                window.localStorage.setItem(SPLIT_KEY_PREFIX + group, String(height));
              } catch {}
            }}
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          {connection === 'connecting' ? (
            <>
              <Loader2Icon className="h-5 w-5 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Connecting to the editor</p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium">This window cannot find the editor</p>
              <p className="max-w-xs text-xs text-muted-foreground">
                The editor window may have been closed. Open it again, then try once more.
              </p>
              <Button variant="outline" size="sm" onClick={retry} className="gap-2">
                <RefreshCwIcon className="h-3.5 w-3.5" />
                Try again
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
