"use client";

// The editor's tab strip: the list, where it is kept, and the parking lot the
// projects of the other tabs wait in.
//
// The layout still decides what is on the canvas. This hook is told about it
// (`noteActive` whenever the open project changes, `recordLeave` as a project
// leaves the canvas) and answers with the list to draw. Keeping it that way
// round means every path that can open a project (a template, Recent projects,
// an import, the cloud, an MCP tool, the agent) puts it in a tab without any of
// them knowing tabs exist.
//
// The list lives in a ref as well as in state, because the layout reads it from
// callbacks that outlive a render and from inside the same event that changed
// it, before React has rendered anything.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { db } from '@/database';
import { isTauri } from '@/lib/desktop';
import {
  createParkingLot,
  DEFAULT_PARKING_BUDGET,
  type ParkedProject,
  type ParkingLot,
  type SleepReason,
} from './parking';
import {
  findTab,
  moveTab,
  openTab,
  rememberClosed,
  removeTab,
  reopenAt,
  tabIndexOf,
  updateTab,
  type ClosedTab,
  type ProjectTab,
  type TabView,
} from './tabModel';
import { readLastSession, readWindowSession, writeSession } from './session';
import { holdEditorWindowLock, otherEditorWindowsOpen } from './presence';
import { sameSummary, type TabSummary } from './summary';

/** How long the strip has to sit still before it is written to storage. */
const SESSION_WRITE_DELAY_MS = 250;
/** The same for a zoom or a scroll, which come in bursts. */
const VIEW_WRITE_DELAY_MS = 400;
/** How often the parking lot looks for tabs that have been left long enough to sleep. */
const SLEEP_CHECK_MS = 60 * 1000;

export interface ProjectTabs {
  tabs: ProjectTab[];
  closed: ClosedTab[];
  /** Where the projects of the inactive tabs wait. See parking.ts. */
  parking: ParkingLot;
  /** The list as of now, including changes made earlier in the same event. */
  getTabs(): ProjectTab[];
  has(projectId: string | null): boolean;
  get(projectId: string | null): ProjectTab | undefined;
  /** The project on the canvas changed. Puts it in a tab if it has none. */
  noteActive(projectId: string, details?: { name?: string; preview?: boolean }): void;
  /** The canvas holds no project now (the last tab closed). */
  noteNoActive(): void;
  /** The + button: whatever opens next gets a tab of its own, at the end. */
  requestNewTab(): void;
  /** The start dialog closed without opening anything, so the + button's tab never happened. */
  dropNewTabRequest(): void;
  rename(projectId: string, name: string): void;
  /** A commit landed on this project, so it is no longer a preview. Cheap when it already was not. */
  noteEdit(projectId: string): void;
  /** Keep how a tab was left, for when it is opened again. */
  recordLeave(projectId: string, details: { view?: TabView; summary?: TabSummary }): void;
  setSummary(projectId: string, summary: TabSummary): void;
  /** Close a tab. It can be reopened from the closed list. */
  close(projectId: string): void;
  /** Take a tab away without remembering it: its project was deleted, or never opened. */
  forget(projectId: string): void;
  move(projectId: string, toIndex: number): void;
  /** Put the most recently closed tab back. Returns it, for the caller to open. */
  reopenClosed(projectId?: string): ClosedTab | null;
  /** Neither the active tab nor parked: its project has to be read when it is opened. */
  isSleeping(projectId: string): boolean;
  /**
   * Went to sleep in this sitting, so its undo stack is on disk and comes back
   * with it. A tab that was not opened since a reload starts its undo over.
   */
  keepsUndo(projectId: string): boolean;
  /** The canvas was zoomed, scrolled or switched to another artboard or language. */
  noteViewChange(): void;
  /** Write the strip now, for a window that is about to close. */
  flushSession(): void;
}

export interface UseProjectTabsOptions {
  /**
   * The key of a window a tab was moved into (tabWindows.ts). Such a window
   * keeps its session under its own key, never decides what the next fresh
   * visit opens, and never brings back what was open last time.
   */
  windowKey?: string | null;
  /**
   * A parked tab went to sleep (parking.ts). Its last chance to write what the
   * lot is letting go of, which for the editor is its undo stack.
   */
  onSleep?: (project: ParkedProject, reason: SleepReason) => void;
  /**
   * How the active tab looks right now. A tab's view is otherwise only taken
   * as it is left, and a reload leaves without leaving it.
   */
  readView?: () => { projectId: string; view: TabView } | null;
}

export function useProjectTabs(options: UseProjectTabsOptions = {}): ProjectTabs {
  const windowKey = options.windowKey ?? null;
  const shareAsLast = !windowKey;
  // Read once, before the first render: a reload brings this window's own tabs
  // straight back, so the strip never paints empty and then fills.
  const [initial] = useState(() => readWindowSession(windowKey));
  const [tabs, setTabsState] = useState<ProjectTab[]>(() => initial?.tabs ?? []);
  const [closed, setClosedState] = useState<ClosedTab[]>(() => initial?.closed ?? []);
  const [activeId, setActiveId] = useState<string | null>(null);
  const tabsRef = useRef(tabs);
  const closedRef = useRef(closed);
  const activeRef = useRef<string | null>(null);
  /** Set by the + button. Any project that opens next consumes it. */
  const newTabRef = useRef(false);
  const onSleepRef = useRef(options.onSleep);
  onSleepRef.current = options.onSleep;
  const readViewRef = useRef(options.readView);
  readViewRef.current = options.readView;
  // Counts the tabs that fell asleep, so the strip draws them asleep.
  const [sleeps, setSleeps] = useState(0);
  const sleptRef = useRef(new Set<string>());
  const [parking] = useState(() =>
    createParkingLot(DEFAULT_PARKING_BUDGET, (project, reason) => {
      sleptRef.current.add(project.projectId);
      onSleepRef.current?.(project, reason);
      setSleeps((count) => count + 1);
    })
  );

  // An hour after a tab was left it goes to sleep. Checked once a minute, and
  // when the window comes back into view: a hidden page's timers are slowed
  // down, and a laptop that was closed for a night fires none at all.
  useEffect(() => {
    const sweep = () => parking.sweep();
    const timer = window.setInterval(sweep, SLEEP_CHECK_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') sweep();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [parking]);

  const commitTabs = useCallback((next: ProjectTab[]) => {
    if (next === tabsRef.current) return;
    tabsRef.current = next;
    setTabsState(next);
  }, []);
  const commitClosed = useCallback((next: ClosedTab[]) => {
    if (next === closedRef.current) return;
    closedRef.current = next;
    setClosedState(next);
  }, []);

  // A fresh window: bring back what was open last time, unless another window
  // still has it open (see presence.ts). Merged rather than replaced, because
  // the URL's project may already have a tab by the time this lands.
  const [restoreToken, setRestoreToken] = useState(0);
  useEffect(() => {
    holdEditorWindowLock();
    if (initial) {
      setRestoreToken((token) => token + 1);
      return;
    }
    // A window a tab was moved into opens on that tab and nothing else.
    if (windowKey) return;
    let cancelled = false;
    (async () => {
      if (!isTauri() && (await otherEditorWindowsOpen()) === true) return;
      const last = readLastSession();
      if (cancelled || !last || last.tabs.length === 0) return;
      const current = tabsRef.current;
      const restored = last.tabs.filter((tab) => tabIndexOf(current, tab.projectId) < 0);
      commitTabs([...restored, ...current]);
      if (closedRef.current.length === 0) commitClosed(last.closed);
      setRestoreToken((token) => token + 1);
    })();
    return () => {
      cancelled = true;
    };
    // Startup only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A restored tab whose project was deleted in the meantime (in another
  // window, or with the browser's site data) has nothing to open. Only the ids
  // that were restored are checked: a project created since may not have
  // reached IndexedDB yet, its first write being debounced.
  useEffect(() => {
    if (restoreToken === 0) return;
    const ids = tabsRef.current.map((tab) => tab.projectId);
    if (ids.length === 0) return;
    let cancelled = false;
    db.projects
      .where(':id')
      .anyOf(ids)
      .primaryKeys()
      .then((keys) => {
        if (cancelled) return;
        const alive = new Set(keys.map(String));
        const gone = new Set(ids.filter((id) => !alive.has(id) && id !== activeRef.current));
        if (gone.size === 0) return;
        commitTabs(tabsRef.current.filter((tab) => !gone.has(tab.projectId)));
        commitClosed(closedRef.current.filter((entry) => !gone.has(entry.projectId)));
      })
      .catch((error) => console.warn('Could not check the restored tabs against the project list', error));
    return () => {
      cancelled = true;
    };
  }, [restoreToken, commitTabs, commitClosed]);

  // Written once the strip has been still for a moment, and again on the way
  // out, so a reload taken in the middle of a burst of tab changes keeps them.
  // The active tab's view is read at the moment of writing: it is otherwise
  // only taken as the tab is left, and a reload never leaves it.
  const writeNow = useCallback(() => {
    let current = tabsRef.current;
    const live = readViewRef.current?.();
    if (live && live.projectId === activeRef.current) current = updateTab(current, live.projectId, { view: live.view });
    writeSession(
      { tabs: current, activeProjectId: activeRef.current, closed: closedRef.current },
      { shareAsLast, windowKey }
    );
  }, [shareAsLast, windowKey]);
  const writeTimerRef = useRef<number | null>(null);
  const scheduleWrite = useCallback(
    (delay: number) => {
      if (writeTimerRef.current !== null) window.clearTimeout(writeTimerRef.current);
      writeTimerRef.current = window.setTimeout(() => {
        writeTimerRef.current = null;
        writeNow();
      }, delay);
    },
    [writeNow]
  );
  const flushSession = useCallback(() => {
    if (writeTimerRef.current !== null) {
      window.clearTimeout(writeTimerRef.current);
      writeTimerRef.current = null;
    }
    writeNow();
  }, [writeNow]);
  useEffect(() => {
    scheduleWrite(SESSION_WRITE_DELAY_MS);
  }, [tabs, closed, activeId, scheduleWrite]);
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flushSession();
    };
    window.addEventListener('pagehide', flushSession);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('pagehide', flushSession);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [flushSession]);
  const noteViewChange = useCallback(() => scheduleWrite(VIEW_WRITE_DELAY_MS), [scheduleWrite]);

  const previewIds = useMemo(() => new Set(tabs.filter((tab) => tab.preview).map((tab) => tab.projectId)), [tabs]);
  const previewIdsRef = useRef(previewIds);
  previewIdsRef.current = previewIds;

  const noteActive = useCallback(
    (projectId: string, details: { name?: string; preview?: boolean } = {}) => {
      const forceNew = newTabRef.current;
      newTabRef.current = false;
      const from = activeRef.current;
      const result = openTab(tabsRef.current, projectId, {
        fromProjectId: from === projectId ? null : from,
        forceNew,
        preview: details.preview,
        name: details.name,
      });
      // The tab it replaced was a preview nobody edited. Its project is saved,
      // so there is nothing in the parking lot worth keeping.
      if (result.replaced) parking.drop(result.replaced);
      commitTabs(updateTab(result.tabs, projectId, { lastActiveAt: Date.now() }));
      activeRef.current = projectId;
      setActiveId(projectId);
    },
    [commitTabs, parking]
  );

  const noteNoActive = useCallback(() => {
    activeRef.current = null;
    setActiveId(null);
  }, []);

  const requestNewTab = useCallback(() => {
    newTabRef.current = true;
  }, []);
  const dropNewTabRequest = useCallback(() => {
    newTabRef.current = false;
  }, []);

  const rename = useCallback(
    (projectId: string, name: string) => {
      if (!name) return;
      commitTabs(updateTab(tabsRef.current, projectId, { name }));
    },
    [commitTabs]
  );

  const noteEdit = useCallback(
    (projectId: string) => {
      if (!previewIdsRef.current.has(projectId)) return;
      commitTabs(updateTab(tabsRef.current, projectId, { preview: false }));
    },
    [commitTabs]
  );

  const recordLeave = useCallback(
    (projectId: string, details: { view?: TabView; summary?: TabSummary }) => {
      const tab = findTab(tabsRef.current, projectId);
      if (!tab) return;
      const patch: Partial<ProjectTab> = {};
      if (details.view) patch.view = details.view;
      if (details.summary && !sameSummary(tab.summary, details.summary)) patch.summary = details.summary;
      commitTabs(updateTab(tabsRef.current, projectId, patch));
    },
    [commitTabs]
  );

  const setSummary = useCallback(
    (projectId: string, summary: TabSummary) => {
      const tab = findTab(tabsRef.current, projectId);
      if (!tab || sameSummary(tab.summary, summary)) return;
      commitTabs(updateTab(tabsRef.current, projectId, { summary }));
    },
    [commitTabs]
  );

  const close = useCallback(
    (projectId: string) => {
      const index = tabIndexOf(tabsRef.current, projectId);
      if (index < 0) return;
      const tab = tabsRef.current[index];
      parking.drop(projectId);
      sleptRef.current.delete(projectId);
      commitTabs(removeTab(tabsRef.current, projectId));
      commitClosed(
        rememberClosed(closedRef.current, { projectId, name: tab.name, index, closedAt: Date.now() })
      );
    },
    [commitTabs, commitClosed, parking]
  );

  const forget = useCallback(
    (projectId: string) => {
      parking.drop(projectId);
      sleptRef.current.delete(projectId);
      commitTabs(removeTab(tabsRef.current, projectId));
      commitClosed(closedRef.current.filter((entry) => entry.projectId !== projectId));
    },
    [commitTabs, commitClosed, parking]
  );

  const move = useCallback(
    (projectId: string, toIndex: number) => {
      commitTabs(moveTab(tabsRef.current, projectId, toIndex));
    },
    [commitTabs]
  );

  const reopenClosed = useCallback(
    (projectId?: string) => {
      const entry = projectId
        ? closedRef.current.find((item) => item.projectId === projectId)
        : closedRef.current[0];
      if (!entry) return null;
      commitClosed(closedRef.current.filter((item) => item.projectId !== entry.projectId));
      commitTabs(reopenAt(tabsRef.current, entry));
      return entry;
    },
    [commitTabs, commitClosed]
  );

  const getTabs = useCallback(() => tabsRef.current, []);
  const has = useCallback((projectId: string | null) => tabIndexOf(tabsRef.current, projectId) >= 0, []);
  const get = useCallback((projectId: string | null) => findTab(tabsRef.current, projectId), []);
  const isSleeping = useCallback(
    (projectId: string) => projectId !== activeRef.current && !parking.has(projectId),
    // A new function when a tab falls asleep, so whatever draws the strip redraws.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [parking, sleeps]
  );
  const keepsUndo = useCallback(
    (projectId: string) => sleptRef.current.has(projectId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sleeps]
  );

  return useMemo(
    () => ({
      tabs,
      closed,
      parking,
      getTabs,
      has,
      get,
      noteActive,
      noteNoActive,
      requestNewTab,
      dropNewTabRequest,
      rename,
      noteEdit,
      recordLeave,
      setSummary,
      close,
      forget,
      move,
      reopenClosed,
      isSleeping,
      keepsUndo,
      noteViewChange,
      flushSession,
    }),
    [
      tabs,
      closed,
      parking,
      getTabs,
      has,
      get,
      noteActive,
      noteNoActive,
      requestNewTab,
      dropNewTabRequest,
      rename,
      noteEdit,
      recordLeave,
      setSummary,
      close,
      forget,
      move,
      reopenClosed,
      isSleeping,
      keepsUndo,
      noteViewChange,
      flushSession,
    ]
  );
}
