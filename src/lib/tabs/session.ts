// Which tabs a window had open, kept across a reload and across visits.
//
// Two copies, for two different questions:
//
//   sessionStorage  "what did THIS window have open". A reload keeps it and a
//                   second browser tab starts without it, which is exactly the
//                   line between one window and another.
//   localStorage    "what was open last time", for a visit that starts with no
//                   window of its own: the next day's first tab, or the desktop
//                   app's next launch. Written by whichever window changed its
//                   tabs last.
//
// Only the list travels. A tab's document and undo stack never reach storage
// (that is what IndexedDB and the versions table are for), so every tab but the
// active one comes back asleep and reads its project when it is opened.

import type { ClosedTab, ProjectTab, TabView } from './tabModel';
import { MAX_CLOSED_TABS } from './tabModel';
import type { TabSummary } from './summary';

export interface TabSession {
  tabs: ProjectTab[];
  activeProjectId: string | null;
  closed: ClosedTab[];
}

const SESSION_KEY = 'open-screenshot-generator.project-tabs';
const LAST_KEY = 'open-screenshot-generator.project-tabs.last';
const VERSION = 1;
/** A strip longer than this is a corrupt file, not a working set. */
const MAX_TABS = 80;

interface StoredSession extends TabSession {
  v: number;
  savedAt: number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function readView(raw: unknown): TabView | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const view = raw as Partial<TabView>;
  if (!isFiniteNumber(view.zoom) || view.zoom <= 0) return undefined;
  const scroll =
    view.scroll && isFiniteNumber(view.scroll.left) && isFiniteNumber(view.scroll.top)
      ? { left: view.scroll.left, top: view.scroll.top }
      : null;
  return {
    activeArtboardId: typeof view.activeArtboardId === 'string' ? view.activeArtboardId : null,
    zoom: view.zoom,
    scroll,
    locale: typeof view.locale === 'string' ? view.locale : null,
  };
}

function readSummary(raw: unknown): TabSummary | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const summary = raw as Partial<TabSummary>;
  if (
    !isFiniteNumber(summary.artboards) ||
    !isFiniteNumber(summary.width) ||
    !isFiniteNumber(summary.height) ||
    typeof summary.accent !== 'string'
  ) {
    return undefined;
  }
  return {
    artboards: summary.artboards,
    width: summary.width,
    height: summary.height,
    accent: summary.accent,
    languages: isFiniteNumber(summary.languages) ? summary.languages : 0,
  };
}

/** A stored session, checked field by field. Anything malformed is dropped rather than trusted. */
export function parseSession(raw: string | null): TabSession | null {
  if (!raw) return null;
  let parsed: Partial<StoredSession>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || parsed.v !== VERSION || !Array.isArray(parsed.tabs)) return null;

  const seen = new Set<string>();
  const tabs: ProjectTab[] = [];
  for (const entry of parsed.tabs.slice(0, MAX_TABS)) {
    if (!entry || typeof entry.projectId !== 'string' || !entry.projectId || seen.has(entry.projectId)) continue;
    seen.add(entry.projectId);
    const tab: ProjectTab = {
      projectId: entry.projectId,
      name: typeof entry.name === 'string' ? entry.name : '',
      lastActiveAt: isFiniteNumber(entry.lastActiveAt) ? entry.lastActiveAt : 0,
    };
    if (entry.preview === true) tab.preview = true;
    const summary = readSummary(entry.summary);
    if (summary) tab.summary = summary;
    const view = readView(entry.view);
    if (view) tab.view = view;
    tabs.push(tab);
  }

  const closed: ClosedTab[] = [];
  if (Array.isArray(parsed.closed)) {
    for (const entry of parsed.closed.slice(0, MAX_CLOSED_TABS)) {
      if (!entry || typeof entry.projectId !== 'string' || !entry.projectId) continue;
      closed.push({
        projectId: entry.projectId,
        name: typeof entry.name === 'string' ? entry.name : '',
        index: isFiniteNumber(entry.index) ? entry.index : 0,
        closedAt: isFiniteNumber(entry.closedAt) ? entry.closedAt : 0,
      });
    }
  }

  const activeProjectId =
    typeof parsed.activeProjectId === 'string' && seen.has(parsed.activeProjectId) ? parsed.activeProjectId : null;
  return { tabs, activeProjectId, closed };
}

export function serializeSession(session: TabSession, now = Date.now()): string {
  const stored: StoredSession = { v: VERSION, savedAt: now, ...session };
  return JSON.stringify(stored);
}

function storage(kind: 'session' | 'local'): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return kind === 'session' ? window.sessionStorage : window.localStorage;
  } catch {
    // A sandboxed frame or a locked down profile throws on the getter itself.
    return null;
  }
}

/**
 * The sessionStorage key of one window. A window opened for a tab carries a key
 * of its own (tabWindows.ts), because a popup starts with a copy of its
 * opener's sessionStorage and must not take that for its own tabs.
 */
function sessionKey(windowKey?: string | null): string {
  return windowKey ? `${SESSION_KEY}:${windowKey}` : SESSION_KEY;
}

/** This window's own tabs, from before a reload. */
export function readWindowSession(windowKey?: string | null): TabSession | null {
  return parseSession(storage('session')?.getItem(sessionKey(windowKey)) ?? null);
}

/** The tabs the last window to change its tabs had open. */
export function readLastSession(): TabSession | null {
  return parseSession(storage('local')?.getItem(LAST_KEY) ?? null);
}

/**
 * Keep the session in both places. `shareAsLast` is off for a window that
 * should not decide what the next visit opens (one a tab was moved into).
 */
export function writeSession(
  session: TabSession,
  options: { shareAsLast?: boolean; windowKey?: string | null } = {}
): void {
  const text = serializeSession(session);
  try {
    storage('session')?.setItem(sessionKey(options.windowKey), text);
  } catch {}
  if (options.shareAsLast === false) return;
  try {
    storage('local')?.setItem(LAST_KEY, text);
  } catch {}
}

/** Forget this window's tabs, so a fresh start does not inherit them. */
export function clearWindowSession(windowKey?: string | null): void {
  try {
    storage('session')?.removeItem(sessionKey(windowKey));
  } catch {}
}
