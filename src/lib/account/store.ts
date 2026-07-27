// Where the signed-in account lives.
//
// One session at a time (you are connected to Drive *or* GitHub, not both),
// persisted to localStorage exactly like the AI provider keys in
// src/lib/ai/providers.ts. A tiny subscribe/notify store rather than context so
// the sidebar button, the dialog and the toolbar all read the same value
// without threading props through OpenScreenshotGeneratorLayout.

import { useCallback, useEffect, useState } from 'react';
import { readWithLegacyFallback, removeWithLegacy } from '@/lib/legacyStorage';
import type { AccountSession, CloudProviderId } from './types';

const STORAGE_KEY = 'open-screenshot-generator.account';

let current: AccountSession | null = null;
let hydrated = false;
const listeners = new Set<() => void>();

function read(): AccountSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = readWithLegacyFallback(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AccountSession>;
    if (!parsed.provider || !parsed.accessToken || !parsed.account?.id) return null;
    return parsed as AccountSession;
  } catch {
    return null;
  }
}

function write(session: AccountSession | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (session) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else removeWithLegacy(STORAGE_KEY);
  } catch {
    // Private mode or a full quota: the sign-in just will not survive a reload.
  }
}

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  current = read();
}

export function getSession(): AccountSession | null {
  hydrate();
  return current;
}

export function setSession(session: AccountSession | null): void {
  hydrate();
  current = session;
  write(session);
  listeners.forEach((fn) => fn());
}

export function clearSession(): void {
  setSession(null);
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The current sign-in, re-rendering on change.
 * Starts null on the server and on the first client render so static export
 * hydration never mismatches; the real value lands in the effect.
 */
export function useAccount(): {
  session: AccountSession | null;
  isSignedIn: boolean;
  provider: CloudProviderId | null;
  signOut: () => void;
} {
  const [session, setLocal] = useState<AccountSession | null>(null);

  useEffect(() => {
    setLocal(getSession());
    return subscribe(() => setLocal(getSession()));
  }, []);

  const signOut = useCallback(() => clearSession(), []);

  return {
    session,
    isSignedIn: !!session,
    provider: session?.provider ?? null,
    signOut,
  };
}
