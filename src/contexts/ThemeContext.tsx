"use client";

// Holds the theme preference for the app chrome. The class on <html> is put
// there before first paint by THEME_BOOT_SCRIPT (see lib/theme.ts); this
// provider owns it from hydration on, and is what the settings dialog talks to.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  DARK_MEDIA_QUERY,
  applyTheme,
  persistTheme,
  readStoredTheme,
  resolveTheme,
  type ResolvedTheme,
  type ThemePreference,
} from '@/lib/theme';

interface ThemeContextValue {
  /** What the user picked: system, light or dark. */
  theme: ThemePreference;
  /** What that currently means on this machine. */
  resolvedTheme: ResolvedTheme;
  setTheme: (preference: ThemePreference) => void;
  /**
   * False until the stored preference has been read. Anything whose markup
   * differs per theme must wait for this, or the static export's HTML and the
   * first client render disagree and React throws a hydration mismatch.
   */
  mounted: boolean;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'system',
  resolvedTheme: 'light',
  setTheme: () => {},
  mounted: false,
});

export const useTheme = () => useContext(ThemeContext);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Both start at the values the server rendered with. localStorage and
  // matchMedia are only readable on the client, so they are read in the effect
  // below rather than in a lazy initialiser.
  const [theme, setThemeState] = useState<ThemePreference>('system');
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('light');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = readStoredTheme();
    setThemeState(stored);
    setResolvedTheme(resolveTheme(stored));
    setMounted(true);
    // The boot script already applied this. Re-applying is what keeps the two
    // honest if the storage key was written by another tab since page load.
    applyTheme(resolveTheme(stored));
  }, []);

  // "System" means system for the whole session, not just at load: the OS
  // flipping to dark has to flip the editor with it.
  useEffect(() => {
    if (theme !== 'system' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(DARK_MEDIA_QUERY);
    const handleChange = (event: MediaQueryListEvent) => {
      const next: ResolvedTheme = event.matches ? 'dark' : 'light';
      setResolvedTheme(next);
      applyTheme(next);
    };
    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, [theme]);

  const setTheme = useCallback((preference: ThemePreference) => {
    const resolved = resolveTheme(preference);
    setThemeState(preference);
    setResolvedTheme(resolved);
    persistTheme(preference);
    applyTheme(resolved);
  }, []);

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme, mounted }),
    [theme, resolvedTheme, setTheme, mounted]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};
