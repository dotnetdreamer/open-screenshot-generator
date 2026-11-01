// The tab strip as data: which projects are open in this window, in what
// order, and what each one remembers for when it comes back.
//
// Pure functions over a plain array, so the strip, the keyboard shortcuts and
// the session restore agree on what opening, closing or moving a tab does, and
// so all of it can be tested without a browser.
//
// A tab IS a project in this window. There is never a second tab for the same
// project, and a tab never outlives its project.

import type { TabSummary } from './summary';

/** Where the canvas was when a tab was left, so coming back lands in the same place. */
export interface TabView {
  activeArtboardId: string | null;
  zoom: number;
  /** The canvas scroll offset, in CSS pixels of the zoomed canvas. */
  scroll: { left: number; top: number } | null;
  /** The language being viewed. Null is the base language. */
  locale: string | null;
}

export interface ProjectTab {
  projectId: string;
  /** The name the project had when it was last open, so a sleeping tab can be drawn without reading it. */
  name: string;
  /**
   * Opened from the template gallery and not edited since. The next project
   * opened from this tab takes its place instead of adding a tab, so looking
   * through templates does not leave one behind for each.
   */
  preview?: boolean;
  /** When the tab was last the active one. */
  lastActiveAt: number;
  summary?: TabSummary;
  view?: TabView;
}

/** A tab that was closed, for "Reopen closed tab". */
export interface ClosedTab {
  projectId: string;
  name: string;
  /** Where it was in the strip, so it comes back in the same place. */
  index: number;
  closedAt: number;
}

/** How many closed tabs "Reopen closed tab" can walk back through. */
export const MAX_CLOSED_TABS = 10;

export function findTab(tabs: readonly ProjectTab[], projectId: string | null): ProjectTab | undefined {
  if (!projectId) return undefined;
  return tabs.find((tab) => tab.projectId === projectId);
}

export function tabIndexOf(tabs: readonly ProjectTab[], projectId: string | null): number {
  if (!projectId) return -1;
  return tabs.findIndex((tab) => tab.projectId === projectId);
}

export interface OpenTabOptions {
  /** The tab the user was on when the project opened. */
  fromProjectId: string | null;
  /**
   * Always add a tab, at the end of the strip, even when the tab the user was
   * on is a preview. What the + button asks for.
   */
  forceNew?: boolean;
  preview?: boolean;
  name?: string;
  now?: number;
}

export interface OpenTabResult {
  tabs: ProjectTab[];
  /** The preview tab this project took the place of, if it did. */
  replaced: string | null;
}

/**
 * Put a project in a tab.
 *
 * Already open: the list comes back with at most its name refreshed. Otherwise
 * the project takes the place of the tab it was opened from when that tab is a
 * preview, goes in right after it when it is not, and goes last when the +
 * button asked for it or there was no tab to open it from.
 */
export function openTab(
  tabs: readonly ProjectTab[],
  projectId: string,
  options: OpenTabOptions
): OpenTabResult {
  const existing = tabIndexOf(tabs, projectId);
  if (existing >= 0) {
    const current = tabs[existing];
    if (!options.name || options.name === current.name) return { tabs: tabs.slice(), replaced: null };
    const next = tabs.slice();
    next[existing] = { ...current, name: options.name };
    return { tabs: next, replaced: null };
  }

  const tab: ProjectTab = {
    projectId,
    name: options.name ?? '',
    lastActiveAt: options.now ?? Date.now(),
    ...(options.preview ? { preview: true } : {}),
  };
  const from = tabIndexOf(tabs, options.fromProjectId);
  if (from >= 0 && !options.forceNew && tabs[from].preview) {
    const next = tabs.slice();
    const replaced = next[from].projectId;
    next[from] = tab;
    return { tabs: next, replaced };
  }
  const at = options.forceNew || from < 0 ? tabs.length : from + 1;
  return { tabs: [...tabs.slice(0, at), tab, ...tabs.slice(at)], replaced: null };
}

/** Change one tab. The same list when there is no such tab or nothing changes. */
export function updateTab(
  tabs: readonly ProjectTab[],
  projectId: string,
  patch: Partial<Omit<ProjectTab, 'projectId'>>
): ProjectTab[] {
  const index = tabIndexOf(tabs, projectId);
  if (index < 0) return tabs as ProjectTab[];
  const current = tabs[index];
  const changed = (Object.keys(patch) as Array<keyof typeof patch>).some((key) => current[key] !== patch[key]);
  if (!changed) return tabs as ProjectTab[];
  const next = tabs.slice();
  const merged: ProjectTab = { ...current, ...patch };
  // An absent flag and a false one mean the same thing, and the session file
  // stays smaller without the second kind.
  if (!merged.preview) delete merged.preview;
  next[index] = merged;
  return next;
}

/**
 * Which tab is active once `projectId` closes: the same one when it was not
 * the active tab, else its right-hand neighbour, else its left, else none.
 */
export function nextActiveAfterClose(
  tabs: readonly ProjectTab[],
  projectId: string,
  activeProjectId: string | null
): string | null {
  if (projectId !== activeProjectId) return activeProjectId;
  const index = tabIndexOf(tabs, projectId);
  if (index < 0) return activeProjectId;
  return tabs[index + 1]?.projectId ?? tabs[index - 1]?.projectId ?? null;
}

export function removeTab(tabs: readonly ProjectTab[], projectId: string): ProjectTab[] {
  const index = tabIndexOf(tabs, projectId);
  if (index < 0) return tabs as ProjectTab[];
  return [...tabs.slice(0, index), ...tabs.slice(index + 1)];
}

/** Move a tab so it ends up at `toIndex` in the list that results. */
export function moveTab(tabs: readonly ProjectTab[], projectId: string, toIndex: number): ProjectTab[] {
  const from = tabIndexOf(tabs, projectId);
  if (from < 0) return tabs as ProjectTab[];
  const target = Math.max(0, Math.min(tabs.length - 1, Math.round(toIndex)));
  if (target === from) return tabs as ProjectTab[];
  const next = tabs.slice();
  const [tab] = next.splice(from, 1);
  next.splice(target, 0, tab);
  return next;
}

/** The ids "Close other tabs" closes, left to right. */
export function otherTabIds(tabs: readonly ProjectTab[], keepId: string): string[] {
  return tabs.filter((tab) => tab.projectId !== keepId).map((tab) => tab.projectId);
}

/** The ids "Close tabs to the right" closes, left to right. */
export function tabIdsRightOf(tabs: readonly ProjectTab[], projectId: string): string[] {
  const index = tabIndexOf(tabs, projectId);
  if (index < 0) return [];
  return tabs.slice(index + 1).map((tab) => tab.projectId);
}

/** The tab `step` places away from the active one, wrapping at either end. */
export function cycleTab(
  tabs: readonly ProjectTab[],
  activeProjectId: string | null,
  step: number
): string | null {
  if (tabs.length === 0) return null;
  const index = tabIndexOf(tabs, activeProjectId);
  if (index < 0) return tabs[step >= 0 ? 0 : tabs.length - 1].projectId;
  const length = tabs.length;
  return tabs[(((index + step) % length) + length) % length].projectId;
}

/**
 * The tab a number shortcut means: 1 to 8 count from the left, and 9 is always
 * the last tab, however many there are. The convention every browser keeps.
 */
export function tabForNumber(tabs: readonly ProjectTab[], digit: number): string | null {
  if (tabs.length === 0 || digit < 1 || digit > 9) return null;
  if (digit === 9) return tabs[tabs.length - 1].projectId;
  return tabs[digit - 1]?.projectId ?? null;
}

/** Remember a closed tab, newest first, once per project. */
export function rememberClosed(closed: readonly ClosedTab[], entry: ClosedTab): ClosedTab[] {
  return [entry, ...closed.filter((item) => item.projectId !== entry.projectId)].slice(0, MAX_CLOSED_TABS);
}

/** Put a closed tab back where it was, or as near as the strip now allows. */
export function reopenAt(tabs: readonly ProjectTab[], entry: ClosedTab, now = Date.now()): ProjectTab[] {
  if (tabIndexOf(tabs, entry.projectId) >= 0) return tabs as ProjectTab[];
  const at = Math.max(0, Math.min(tabs.length, entry.index));
  const tab: ProjectTab = { projectId: entry.projectId, name: entry.name, lastActiveAt: now };
  return [...tabs.slice(0, at), tab, ...tabs.slice(at)];
}
