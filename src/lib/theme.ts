// App theme: the editor chrome only. Artboards are the user's artwork and are
// walled off from the dark palette in globals.css, so a design looks the same
// on screen as it does in the exported PNG whichever theme is on.
//
// Three preferences, not a boolean: "system" follows the OS and keeps following
// it, so switching the Mac to dark at sunset switches the editor too.

export type ThemePreference = 'system' | 'light' | 'dark';

/** What "system" actually resolved to. Only ever light or dark. */
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'open-screenshot-generator.theme';

export const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

/** The stored preference, or "system" when nothing is stored or storage is blocked. */
export function readStoredTheme(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function persistTheme(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Private mode with storage blocked. The choice holds for this session.
  }
}

export function systemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
  return window.matchMedia(DARK_MEDIA_QUERY).matches ? 'dark' : 'light';
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === 'system' ? systemTheme() : preference;
}

/**
 * Writes the theme onto <html>. `color-scheme` is not cosmetic: it is what
 * makes the browser's own chrome (scrollbars, form controls, the flash of
 * canvas before first paint) follow the theme.
 */
export function applyTheme(resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;
}

/**
 * Runs synchronously in <head>, before the body is parsed, so the first paint is
 * already the right theme. Without it every dark-mode load flashes the light
 * palette until React hydrates. Inlined as a string because a static export has
 * no server to read the preference on.
 *
 * Keep it in sync with readStoredTheme/resolveTheme/applyTheme above; it cannot
 * import them, it has to run before any bundle loads.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var p=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY
)});if(p!=='light'&&p!=='dark')p='system';var d=p==='dark'||(p==='system'&&window.matchMedia(${JSON.stringify(
  DARK_MEDIA_QUERY
)}).matches);var e=document.documentElement;e.classList.toggle('dark',d);e.style.colorScheme=d?'dark':'light';}catch(e){}})();`;
