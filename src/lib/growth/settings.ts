// The growth feature's own choices, in localStorage beside the store keys.
//
// The App Store Connect key itself is NOT here: it is the one the publish
// dialog already keeps (src/lib/publish/credentials.ts), so connecting once
// covers uploading and reading.

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'open-screenshot-generator.growth';

export interface GrowthSettings {
  /** The app Growth shows. The account's first app when unset. */
  appId?: string;
  /**
   * Sales and Trends needs it on every request. It is in App Store Connect
   * under Payments and Financial Reports, top left, all digits.
   */
  vendorNumber?: string;
  /**
   * Let MCP clients other than the app's own agents read store numbers.
   * Off by default: those numbers include sales, and any program the user
   * connected to the design server would otherwise be able to read them.
   */
  shareWithClients?: boolean;
  /** Sync automatically once the last sync is older than this many hours. 0 turns it off. */
  refreshHours?: number;
  /**
   * While the desktop app is open, sync the apps synced here before on the
   * same schedule with the editor in front, and say when new insights
   * turn up (monitor.ts).
   */
  monitor?: boolean;
  /** How far back Sales and Trends is filled in, in days. Apple keeps a year of daily reports. */
  historyDays?: number;
  /**
   * Which AI writes replies, listing text, summaries and answers (ai.ts):
   * automatic takes Claude Code, then Codex, then the AI panel's provider.
   */
  aiWriter?: 'auto' | 'claude' | 'codex' | 'panel';
}

const DEFAULTS: Required<Pick<GrowthSettings, 'shareWithClients' | 'refreshHours' | 'historyDays' | 'monitor'>> = {
  shareWithClients: false,
  refreshHours: 6,
  historyDays: 365,
  monitor: true,
};

let current: GrowthSettings | null = null;
const listeners = new Set<() => void>();

function read(): GrowthSettings {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as GrowthSettings) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

let listening = false;

/**
 * A change made in another editor window arrives as a `storage` event. Only
 * the main window runs the design server, so without this a tab window that
 * turns store sharing off would leave main sharing until it reloads.
 */
function listenAcrossWindows(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    current = read();
    listeners.forEach((listener) => listener());
  });
}

export function getGrowthSettings(): GrowthSettings & typeof DEFAULTS {
  listenAcrossWindows();
  if (!current) current = read();
  return { ...DEFAULTS, ...current };
}

/** Straight from storage, for the decisions that must not trust a cache (who may read sales). */
export function readGrowthSettingsFresh(): GrowthSettings & typeof DEFAULTS {
  return { ...DEFAULTS, ...read() };
}

export function setGrowthSettings(patch: Partial<GrowthSettings>): void {
  current = { ...(current ?? read()), ...patch };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Private mode or a full quota: the choice lasts until reload.
  }
  listeners.forEach((listener) => listener());
}

export function subscribeGrowthSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The settings, re-rendering on change, empty until mounted so the static export never mismatches. */
export function useGrowthSettings(): [GrowthSettings & typeof DEFAULTS, (patch: Partial<GrowthSettings>) => void] {
  const [settings, setSettings] = useState<GrowthSettings & typeof DEFAULTS>({ ...DEFAULTS });
  useEffect(() => {
    setSettings(getGrowthSettings());
    return subscribeGrowthSettings(() => setSettings(getGrowthSettings()));
  }, []);
  return [settings, useCallback((patch: Partial<GrowthSettings>) => setGrowthSettings(patch), [])];
}
