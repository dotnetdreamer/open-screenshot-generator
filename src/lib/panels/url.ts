// Which browsing context this bundle is running in.
//
// The same static export serves three roles: the editor window, a detached
// panel window (Properties / Layers / History / Versions living on another
// monitor), and, on the web, whatever tab the user opened. All three load the
// same `/` document, so the URL is what tells them apart, and every module that
// must behave differently in a panel window reads it from here.
//
// Deliberately dependency free. <Analytics /> and <AdSense /> import it from
// the root layout, which renders in every window, so this file must not pull
// the editor, Dexie or the Tauri plugins in behind it.

/** Panels that can live in a window of their own. Order is the tab order. */
export const DETACHABLE_PANELS = ['properties', 'history', 'versions', 'layers'] as const;
export type DetachablePanel = (typeof DETACHABLE_PANELS)[number];

/** The query key that turns `/` into a panel window. */
export const PANEL_PARAM = 'panel';
/** The query key carrying the id of the editor window that opened it. */
export const PANEL_HOST_PARAM = 'host';

/**
 * `?panel=dock` means the whole right dock, which is the common case and the
 * only value the collapsed-rail buttons ever produce. A comma separated list of
 * panel names is also accepted so one panel can be torn off on its own.
 */
export const PANEL_GROUP_ALL = 'dock';

function search(): URLSearchParams | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search);
}

/** True in a detached panel window, false in the editor and during prerender. */
export function isDetachedPanelWindow(): boolean {
  return !!search()?.get(PANEL_PARAM);
}

/** Which panels this window was asked to show. Empty in the editor window. */
export function panelsFromUrl(): DetachablePanel[] {
  const raw = search()?.get(PANEL_PARAM);
  if (!raw) return [];
  if (raw === PANEL_GROUP_ALL) return [...DETACHABLE_PANELS];
  const wanted = raw.split(',').map((part) => part.trim());
  const picked = DETACHABLE_PANELS.filter((panel) => wanted.includes(panel));
  // An unknown value is a stale link, not a reason to show an empty window.
  return picked.length ? picked : [...DETACHABLE_PANELS];
}

/** The editor window that opened this panel window, when it said so. */
export function hostIdFromUrl(): string | null {
  return search()?.get(PANEL_HOST_PARAM) ?? null;
}

/**
 * The URL a panel window loads.
 *
 * Relative on purpose: Tauri resolves it against the app URL (the dev server in
 * `tauri dev`, the bundled `index.html` in a release), and a browser resolves it
 * against the deployed base path, so neither needs to know the other's origin.
 * It stays on `/` rather than a route of its own because `output: 'export'`
 * would give a second route a second HTML entry point, and Tauri's asset
 * resolver and `next dev` disagree about whether that is `/panel` or
 * `/panel.html`.
 */
export function panelWindowUrl(panels: DetachablePanel[] | 'dock', hostId: string): string {
  const value =
    panels === PANEL_GROUP_ALL || (Array.isArray(panels) && panels.length === DETACHABLE_PANELS.length)
      ? PANEL_GROUP_ALL
      : (panels as DetachablePanel[]).join(',');
  const base = typeof window === 'undefined' ? '/' : window.location.pathname;
  return `${base}?${PANEL_PARAM}=${encodeURIComponent(value)}&${PANEL_HOST_PARAM}=${encodeURIComponent(hostId)}`;
}
