// The desktop app's Uptime commands (src-tauri/src/uptime/mod.rs). Each one
// answers editor windows only, and every refusal is a plain sentence a toast
// can show as it is.

import { isTauri } from '@/lib/desktop';
import type { Beat, BeatPayload, Bucket, Monitor, Settings, Target, TestResult, UptimeAlert, UptimeEvent, UptimeView } from './types';

export const BEAT_EVENT = 'uptime://beat';
export const STATE_EVENT = 'uptime://state';
export const ALERT_EVENT = 'uptime://alert';

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error('Uptime needs the desktop app');
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

export const uptimeCommands = {
  state: () => call<UptimeView>('abs_uptime_state'),
  save: (monitor: Monitor) => call<Monitor>('abs_uptime_save', { monitor }),
  remove: (id: string) => call<void>('abs_uptime_delete', { id }),
  pause: (id: string, until: number | null) => call<void>('abs_uptime_pause', { id, until }),
  resume: (id: string) => call<void>('abs_uptime_resume', { id }),
  /** One monitor now, or all of them when `id` is left out. */
  check: (id?: string) => call<void>('abs_uptime_check', { id: id ?? null }),
  test: (monitor: Monitor) => call<TestResult>('abs_uptime_test', { monitor }),
  clear: (id: string) => call<void>('abs_uptime_clear', { id }),
  reorder: (ids: string[]) => call<void>('abs_uptime_reorder', { ids }),
  saveSettings: (settings: Settings) => call<Settings>('abs_uptime_settings', { settings }),
  /** A test alert on this computer (no target) or to one place. */
  testAlert: (target: Target | null) => call<string>('abs_uptime_alert_test', { target }),
  beats: (id: string, from: number, to: number) => call<Beat[]>('abs_uptime_beats', { id, from, to }),
  hours: (id: string, from: number, to: number) => call<Bucket[]>('abs_uptime_hours', { id, from, to }),
  events: (id: string | null, limit = 50) => call<UptimeEvent[]>('abs_uptime_events', { id, limit }),
};

export interface UptimeListeners {
  beat?: (payload: BeatPayload) => void;
  state?: (view: UptimeView) => void;
  alert?: (alert: UptimeAlert) => void;
}

/** Listens to what Rust says. Resolves to a function that stops listening. */
export async function listenUptime(listeners: UptimeListeners): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  const stops = await Promise.all([
    listeners.beat ? listen<BeatPayload>(BEAT_EVENT, (event) => listeners.beat?.(event.payload)) : null,
    listeners.state ? listen<UptimeView>(STATE_EVENT, (event) => listeners.state?.(event.payload)) : null,
    listeners.alert ? listen<UptimeAlert>(ALERT_EVENT, (event) => listeners.alert?.(event.payload)) : null,
  ]);
  return () => {
    for (const stop of stops) stop?.();
  };
}
