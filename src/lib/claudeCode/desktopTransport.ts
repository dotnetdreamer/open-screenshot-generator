// The desktop app's way to Claude Code: Rust spawns `claude` (claude_code.rs)
// and relays its output here as events. Import-safe on the web, where every
// call rejects and nothing is ever imported from Tauri.

import { isTauri } from '@/lib/desktop';
import type {
  AgentFolder,
  ClaudeDetection,
  ClaudeListedProcess,
  ClaudeStartArgs,
  ClaudeStartInfo,
  ClaudeTransport,
  ClaudeTransportEvent,
} from './types';

/** Must match EVENT in src-tauri/src/claude_code.rs. */
export const CLAUDE_EVENT = 'abs-claude-event';

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error('Claude Code runs in the desktop app');
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  try {
    return await tauriInvoke<T>(command, args);
  } catch (error) {
    // Tauri rejects with the command's Err string, not an Error.
    throw error instanceof Error ? error : new Error(String(error));
  }
}

export const desktopTransport: ClaudeTransport = {
  kind: 'desktop',
  detect: () => invoke<ClaudeDetection>('abs_claude_detect'),
  start: (args: ClaudeStartArgs) => invoke<ClaudeStartInfo>('abs_claude_start', { args }),
  send: (spawnId, line) => invoke<void>('abs_claude_send', { spawnId, line }),
  closeInput: (spawnId) => invoke<void>('abs_claude_close_input', { spawnId }),
  stop: (spawnId) => invoke<void>('abs_claude_stop', { spawnId }),
  list: () => invoke<ClaudeListedProcess[]>('abs_claude_list'),
  pageEpoch: () => invoke<number>('abs_claude_page_epoch'),
  // The dialog is Rust's, never the page's: a path only reaches Claude Code if
  // the user picked it there (rule 37 in AGENTS.md).
  pickFolder: (near) => invoke<AgentFolder | null>('abs_claude_pick_folder', near ? { near } : {}),
  forgetFolder: (path) => invoke<void>('abs_claude_forget_folder', { path }),
  // A tauri::ipc::Response on the Rust side, so the bytes arrive as an
  // ArrayBuffer rather than as a JSON array of numbers.
  readProjectImage: (path) => invoke<ArrayBuffer>('abs_claude_read_project_image', { path }),
  async listen(callback: (event: ClaudeTransportEvent) => void) {
    if (!isTauri()) return () => {};
    // Rust stamps every event with a nonce only this window can read. The
    // assistant windows host third-party sites and may emit events too, and
    // one in this name must not reach the chat.
    const nonce = await invoke<string>('abs_mcp_bridge_nonce');
    const { listen } = await import('@tauri-apps/api/event');
    const unlisten = await listen<ClaudeTransportEvent & { nonce?: string }>(CLAUDE_EVENT, (event) => {
      if (event.payload?.nonce !== nonce) return;
      callback(event.payload);
    });
    return () => unlisten();
  },
};
