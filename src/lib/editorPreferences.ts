"use client";

// The two editor switches that are read from more than one place.
//
// A preference here has to be readable by a plain module (the cloud auto saver),
// by a component that renders on every wheel event (CanvasArea), and by the
// settings dialog that writes it, with all three agreeing the moment one of them
// changes. localStorage alone gives none of that: it is synchronous but silent,
// so a toggle in Settings would not reach an already mounted canvas until the
// next reload, and a `storage` event only fires in the OTHER tabs.
//
// So: one cache, one listener set, one place that knows the key names. Reads are
// served from the cache, which is what makes `useEditorPreference` safe to call
// from a component that re-renders constantly. Writes update the cache, write
// through to localStorage, and tell everybody.
//
// Adding one: a line in KEYS, a line in DEFAULTS, and a row in SettingsDialog.

import { useCallback, useSyncExternalStore } from 'react';

export type EditorPreference =
  /** Keep the open project in our cloud without anybody clicking Save. */
  | 'cloudAutoSave'
  /** Turn a mouse wheel over the canvas into zoom rather than scroll. */
  | 'wheelZoom';

const KEYS: Record<EditorPreference, string> = {
  cloudAutoSave: 'open-screenshot-generator.cloud-auto-save',
  wheelZoom: 'open-screenshot-generator.wheel-zoom',
};

/**
 * What each switch does before anybody has an opinion.
 *
 * Both default ON. Auto save is the whole point of the feature: a copy in the
 * cloud that only exists once somebody remembers to ask for one is a copy most
 * people never have. Wheel zoom is on because a wheel is the control people
 * reach for to zoom, and a trackpad is never treated as one (see CanvasArea).
 */
const DEFAULTS: Record<EditorPreference, boolean> = {
  cloudAutoSave: true,
  wheelZoom: true,
};

const cache = new Map<EditorPreference, boolean>();
const listeners = new Set<() => void>();
let watchingStorage = false;

/** Cross-tab: a change in another tab fires `storage` here, never our own event. */
function watchStorage(): void {
  if (watchingStorage || typeof window === 'undefined') return;
  watchingStorage = true;
  window.addEventListener('storage', (event) => {
    if (!event.key) return;
    const name = (Object.keys(KEYS) as EditorPreference[]).find((key) => KEYS[key] === event.key);
    if (!name) return;
    cache.delete(name);
    listeners.forEach((listener) => listener());
  });
}

export function readPreference(name: EditorPreference): boolean {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;
  if (typeof window === 'undefined') return DEFAULTS[name];
  watchStorage();
  let value = DEFAULTS[name];
  try {
    const stored = window.localStorage.getItem(KEYS[name]);
    if (stored === '1') value = true;
    else if (stored === '0') value = false;
  } catch {
    // Private mode, or storage switched off. The default holds for this session.
  }
  cache.set(name, value);
  return value;
}

export function writePreference(name: EditorPreference, value: boolean): void {
  cache.set(name, value);
  try {
    window.localStorage.setItem(KEYS[name], value ? '1' : '0');
  } catch {
    // As above: the choice holds for this tab and is forgotten on reload.
  }
  listeners.forEach((listener) => listener());
}

/** Every reader is told, including the ones that are not React components. */
export function subscribePreferences(listener: () => void): () => void {
  listeners.add(listener);
  watchStorage();
  return () => {
    listeners.delete(listener);
  };
}

/**
 * One switch, live.
 *
 * `useSyncExternalStore` rather than state plus an effect because the value is
 * read during the FIRST client render (the canvas wheel handler wants it) while
 * a static export has no localStorage at build time: the third argument is what
 * keeps the server snapshot and the hydrating one identical, so the default is
 * rendered, then corrected in the same commit rather than mismatching.
 */
export function useEditorPreference(
  name: EditorPreference
): [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(
    subscribePreferences,
    () => readPreference(name),
    () => DEFAULTS[name]
  );
  const set = useCallback((next: boolean) => writePreference(name, next), [name]);
  return [value, set];
}
