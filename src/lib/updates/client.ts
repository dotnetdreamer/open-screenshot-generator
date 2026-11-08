// The Tauri side of updates: four commands and three events (updater.rs).
//
// Loaded with dynamic import() like every other Tauri call in the app, so the
// web bundle never evaluates @tauri-apps/api, and every function is a no-op
// outside the desktop shell.

import { isTauri } from '@/lib/desktop';
import type { UpdateChannel, UpdateSnapshot } from './types';

/** Every change of state, sent to `main`. */
export const UPDATE_STATE_EVENT = 'abs-update-state';
/** Rust asks each editor window to write its edits before an install. */
export const UPDATE_FLUSH_EVENT = 'abs-update-flush';
/** Help > Check for updates. */
export const UPDATE_CHECK_REQUEST_EVENT = 'abs-update-check-requested';

/** The state now, or null on the web and in a shell that has no updater. */
export async function fetchUpdateState(): Promise<UpdateSnapshot | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<UpdateSnapshot>('abs_update_state');
  } catch (error) {
    console.error('Could not read the update state.', error);
    return null;
  }
}

/**
 * Asks the update server about `channel`. Resolves with the state once the
 * server has answered; a download it starts carries on afterwards and reports
 * through UPDATE_STATE_EVENT.
 */
export async function requestUpdateCheck(channel: UpdateChannel): Promise<UpdateSnapshot> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<UpdateSnapshot>('abs_update_check', { channel });
}

/**
 * Installs the downloaded update and restarts into it. On success the app
 * restarts and this never settles; it rejects with the reason when the
 * install failed, and the update is still ready to try again.
 */
export async function installUpdate(): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('abs_update_install');
}

/** Tells Rust whether this window's edits are written for the install numbered `nonce`. */
export async function reportEditsWritten(nonce: number, ok: boolean): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('abs_update_flushed', { nonce, ok });
}

async function listenTo<T>(event: string, handler: (payload: T) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  return listen<T>(event, (message) => handler(message.payload));
}

export function listenUpdateState(handler: (snapshot: UpdateSnapshot) => void): Promise<() => void> {
  return listenTo<UpdateSnapshot>(UPDATE_STATE_EVENT, handler);
}

export function listenUpdateFlush(handler: (nonce: number) => void): Promise<() => void> {
  return listenTo<number>(UPDATE_FLUSH_EVENT, handler);
}

export function listenUpdateCheckRequest(handler: () => void): Promise<() => void> {
  return listenTo<null>(UPDATE_CHECK_REQUEST_EVENT, () => handler());
}
