// The desktop app's way to Codex: Rust runs `codex app-server` (codex.rs),
// speaks its protocol, and relays the conversation here as events. Import-safe
// on the web, where every call rejects and nothing is imported from Tauri.

import { isTauri } from '@/lib/desktop';
import type {
  CodexDetection,
  CodexListedProcess,
  CodexStartArgs,
  CodexStartInfo,
  CodexTransport,
  CodexTransportEvent,
  CodexTurn,
} from './types';

/** Must match EVENT in src-tauri/src/codex.rs. */
export const CODEX_EVENT = 'abs-codex-event';

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error('Codex runs in the desktop app');
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  try {
    return await tauriInvoke<T>(command, args);
  } catch (error) {
    // Tauri rejects with the command's Err string, not an Error.
    throw error instanceof Error ? error : new Error(String(error));
  }
}

export const codexTransport: CodexTransport = {
  detect: () => invoke<CodexDetection>('abs_codex_detect'),
  start: (args: CodexStartArgs) => invoke<CodexStartInfo>('abs_codex_start', { args }),
  send: (spawnId: string, turn: CodexTurn) => invoke<void>('abs_codex_send', { spawnId, turn }),
  interrupt: (spawnId) => invoke<void>('abs_codex_interrupt', { spawnId }),
  stop: (spawnId) => invoke<void>('abs_codex_stop', { spawnId }),
  list: () => invoke<CodexListedProcess[]>('abs_codex_list'),
  pageEpoch: () => invoke<number>('abs_codex_page_epoch'),
  async listen(callback: (event: CodexTransportEvent) => void) {
    if (!isTauri()) return () => {};
    // The same nonce the Claude Code events carry: only the editor window can
    // read it, and the assistant windows may emit events in this name too.
    const nonce = await invoke<string>('abs_mcp_bridge_nonce');
    const { listen } = await import('@tauri-apps/api/event');
    const unlisten = await listen<CodexTransportEvent & { nonce?: string }>(CODEX_EVENT, (event) => {
      if (event.payload?.nonce !== nonce) return;
      callback(event.payload);
    });
    return () => unlisten();
  },
};
