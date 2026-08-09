// Where the store API keys live.
//
// Same shape and the same honesty as the account session store
// (src/lib/account/store.ts) and the AI provider keys
// (src/lib/ai/providers.ts): localStorage, unencrypted, on the user's own
// machine, and the dialog says so out loud. There is no server to hold them
// and no keychain API in a webview, so pretending otherwise would be worse
// than saying it plainly.
//
// The key is new in this feature, so unlike the three keys in legacyStorage.ts
// there is no pre-rename `artboard-studio.` value to migrate: plain
// localStorage is correct here.

import { useCallback, useEffect, useState } from 'react';
import type { AppStoreCredentials, PlayCredentials, StoreCredentials, StoreId } from './types';

const STORAGE_KEY = 'open-screenshot-generator.store-credentials';

let current: StoreCredentials | null = null;
let hydrated = false;
const listeners = new Set<() => void>();

function read(): StoreCredentials {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoreCredentials;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function write(value: StoreCredentials): void {
  if (typeof window === 'undefined') return;
  try {
    const empty = !value.appstore && !value.playstore;
    if (empty) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Private mode or a full quota: the keys just will not survive a reload.
  }
}

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  current = read();
}

export function getStoreCredentials(): StoreCredentials {
  hydrate();
  return current ?? {};
}

export function setAppStoreCredentials(value: AppStoreCredentials | null): void {
  hydrate();
  current = { ...getStoreCredentials(), appstore: value ?? undefined };
  write(current);
  listeners.forEach((fn) => fn());
}

export function setPlayCredentials(value: PlayCredentials | null): void {
  hydrate();
  current = { ...getStoreCredentials(), playstore: value ?? undefined };
  write(current);
  listeners.forEach((fn) => fn());
}

export function clearStoreCredentials(store: StoreId): void {
  if (store === 'appstore') setAppStoreCredentials(null);
  else setPlayCredentials(null);
}

export function subscribeToStoreCredentials(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The saved keys, re-rendering on change. Starts empty on the server and on
 * the first client render so the static export never hydrate-mismatches, the
 * same contract as useAccount().
 */
export function useStoreCredentials(): {
  credentials: StoreCredentials;
  saveAppStore: (value: AppStoreCredentials | null) => void;
  savePlay: (value: PlayCredentials | null) => void;
} {
  const [credentials, setLocal] = useState<StoreCredentials>({});

  useEffect(() => {
    setLocal(getStoreCredentials());
    return subscribeToStoreCredentials(() => setLocal({ ...getStoreCredentials() }));
  }, []);

  return {
    credentials,
    saveAppStore: useCallback((value: AppStoreCredentials | null) => setAppStoreCredentials(value), []),
    savePlay: useCallback((value: PlayCredentials | null) => setPlayCredentials(value), []),
  };
}
