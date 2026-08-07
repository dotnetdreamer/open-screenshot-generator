"use client";

// Dependency-free UI localization. The app is a fully client-side static
// export, so a React context plus plain TS message catalogs is all we need:
// no router segments, no server negotiation. `en` is the source of truth and
// types every other catalog, so a missing translation fails typecheck.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { en, type MessageKey, type Messages } from './messages/en';
import { es } from './messages/es';

export const LOCALES = [
  { id: 'en', label: 'English' },
  { id: 'es', label: 'Español' },
] as const;

export type Locale = (typeof LOCALES)[number]['id'];

const STORAGE_KEY = 'osg-locale';

const CATALOGS: Record<Locale, Messages> = { en, es };

function isLocale(value: string | null): value is Locale {
  return value === 'en' || value === 'es';
}

// First-run detection: a stored choice wins; otherwise take the browser
// language when it maps onto a catalog, else English.
export function detectLocale(): Locale {
  if (typeof window === 'undefined') return 'en';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {}
  const nav = (window.navigator.language || '').toLowerCase();
  if (nav.startsWith('es')) return 'es';
  return 'en';
}

export function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match
  );
}

export type TFunction = (key: MessageKey, vars?: Record<string, string | number>) => string;

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: TFunction;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  // Always start on 'en' so the static prerender and the first client render
  // agree; the stored/detected locale is applied in an effect after mount
  // (same pattern the palette uses for its persisted tab).
  const [locale, setLocaleState] = useState<Locale>('en');

  useEffect(() => {
    setLocaleState(detectLocale());
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {}
  }, []);

  const t = useCallback<TFunction>(
    (key, vars) => {
      const catalog = CATALOGS[locale];
      const template = catalog[key] ?? en[key] ?? key;
      return interpolate(template, vars);
    },
    [locale]
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Outside the provider (should not happen inside the app shell), fall back
    // to English rather than crashing a render.
    return {
      locale: 'en',
      setLocale: () => {},
      t: (key, vars) => interpolate(en[key] ?? key, vars),
    };
  }
  return ctx;
}

/** Translate a catalog key, with {placeholder} interpolation. */
export function useT(): TFunction {
  return useI18n().t;
}

/** Current locale + setter, for the language switcher. */
export function useLocale(): { locale: Locale; setLocale: (locale: Locale) => void } {
  const { locale, setLocale } = useI18n();
  return { locale, setLocale };
}
