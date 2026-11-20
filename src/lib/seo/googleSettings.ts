// What the SEO view keeps for Google: a service account key (or the choice
// to use the one Growth has for Google Play), a free API key for PageSpeed
// and Core Web Vitals, and which Search Console and Analytics property belong
// to each site. localStorage, like the store keys (publish/credentials.ts):
// a webview has no keychain, and the key never leaves this computer except
// to Google.

import { useSyncExternalStore } from 'react';
import { getStoreCredentials, subscribeToStoreCredentials } from '@/lib/publish/credentials';
import { parseServiceAccount } from '@/lib/publish/googlePlay';

const STORAGE_KEY = 'open-screenshot-generator.seo-google';

export interface SiteProperties {
  /** "sc-domain:example.com" or a URL-prefix property such as "https://name.github.io/app/". */
  searchConsole?: string;
  /** "properties/123456789". */
  analytics?: string;
  analyticsName?: string;
}

export interface SeoGoogleSettings {
  /** A service account key file (JSON) added for SEO. */
  key: string | null;
  /** Use Growth's Google Play key instead of `key`. */
  useGrowthKey: boolean;
  /** A Google API key for PageSpeed Insights and the Chrome UX Report. */
  apiKey: string | null;
  sites: Record<string, SiteProperties>;
}

const EMPTY: SeoGoogleSettings = { key: null, useGrowthKey: false, apiKey: null, sites: {} };
const listeners = new Set<() => void>();
let cache: SeoGoogleSettings | null = null;

function read(): SeoGoogleSettings {
  if (typeof window === 'undefined') return EMPTY;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<SeoGoogleSettings>;
    return {
      key: typeof parsed.key === 'string' ? parsed.key : null,
      useGrowthKey: parsed.useGrowthKey === true,
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : null,
      sites: parsed.sites && typeof parsed.sites === 'object' ? parsed.sites : {},
    };
  } catch {
    return EMPTY;
  }
}

export function getSeoGoogle(): SeoGoogleSettings {
  cache ??= read();
  return cache;
}

export function setSeoGoogle(patch: Partial<SeoGoogleSettings>): void {
  const next = { ...getSeoGoogle(), ...patch };
  cache = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage is full or blocked; the setting lasts for this sitting.
  }
  for (const listener of listeners) listener();
}

export function setSiteProperties(siteId: string, patch: SiteProperties): void {
  const sites = { ...getSeoGoogle().sites };
  sites[siteId] = { ...sites[siteId], ...patch };
  setSeoGoogle({ sites });
}

export function subscribeSeoGoogle(listener: () => void): () => void {
  listeners.add(listener);
  const stopStore = subscribeToStoreCredentials(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    cache = null;
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    stopStore();
    window.removeEventListener('storage', onStorage);
  };
}

/** The key Growth has for Google Play, when there is one. */
export function growthGoogleKey(): string | null {
  return getStoreCredentials().playstore?.serviceAccountJson ?? null;
}

export interface ActiveKey {
  json: string;
  email: string;
  projectId: string | null;
  from: 'seo' | 'growth';
}

/** The service account the SEO view uses, or null. */
export function activeServiceAccount(settings: SeoGoogleSettings = getSeoGoogle()): ActiveKey | null {
  const growth = growthGoogleKey();
  const json = settings.useGrowthKey ? growth : settings.key;
  if (!json) return null;
  try {
    const account = parseServiceAccount(json) as { client_email: string; project_id?: string };
    return { json, email: account.client_email, projectId: account.project_id ?? null, from: settings.useGrowthKey ? 'growth' : 'seo' };
  } catch {
    return null;
  }
}

/** A Google API key's shape: "AIza" and 35 more letters, digits, dashes or underscores. */
export function isGoogleApiKey(value: string): boolean {
  return /^AIza[0-9A-Za-z_-]{35}$/.test(value.trim());
}

/** Check a key file someone picked or pasted, and say what's wrong in words for the screen. */
export function readKeyFile(text: string): { json: string; email: string } | { problem: string } {
  try {
    const parsed = JSON.parse(text) as { type?: string; client_email?: string; private_key?: string };
    if (parsed.type !== 'service_account' || !parsed.client_email || !parsed.private_key) {
      return { problem: "That file isn't a service account key. Pick the JSON file Google Cloud gave you for the service account" };
    }
    return { json: text, email: parsed.client_email };
  } catch {
    return { problem: "That file isn't a key file. Pick the .json file Google Cloud downloaded" };
  }
}

export function useSeoGoogle(): SeoGoogleSettings & { active: ActiveKey | null; growthKey: boolean } {
  const settings = useSyncExternalStore(subscribeSeoGoogle, getSeoGoogle, () => EMPTY);
  const growth = useSyncExternalStore(subscribeToStoreCredentials, growthGoogleKey, () => null);
  return { ...settings, active: activeServiceAccount(settings), growthKey: Boolean(growth) };
}
