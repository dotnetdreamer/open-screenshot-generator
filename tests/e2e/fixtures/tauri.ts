import type { Page } from '@playwright/test';
import type { TauriCall, TauriWrittenFile } from './tauri-runtime';

/** An event the app emitted onto the Tauri bus. */
export interface TauriEmittedEvent {
  event: string;
  payload: unknown;
}

/**
 * Test-side handle on the injected Tauri runtime.
 *
 * On the `web` project `enabled` is false and every read returns empty, so a
 * shared spec can assert "the app did NOT talk to the desktop shell" on the
 * web without branching.
 */
export class TauriHarness {
  constructor(
    private readonly page: Page,
    /** True only on a project that injected the desktop runtime. */
    readonly enabled: boolean
  ) {}

  private async read<T>(key: 'calls' | 'files' | 'openedUrls' | 'unhandled' | 'emitted'): Promise<T[]> {
    if (!this.enabled) return [];
    return this.page.evaluate((k) => {
      const state = (window as unknown as Record<string, Record<string, unknown[]>>).__E2E_TAURI__;
      return (state?.[k] ?? []) as unknown[];
    }, key) as Promise<T[]>;
  }

  /** Every IPC call the app has made, oldest first. */
  calls(): Promise<TauriCall[]> {
    return this.read<TauriCall>('calls');
  }

  /** Every call to one command. */
  async callsTo(cmd: string): Promise<TauriCall[]> {
    return (await this.calls()).filter((c) => c.cmd === cmd);
  }

  /** Files the app asked the shell to write, in order. */
  files(): Promise<TauriWrittenFile[]> {
    return this.read<TauriWrittenFile>('files');
  }

  /** URLs handed to the system browser via the opener plugin. */
  openedUrls(): Promise<string[]> {
    return this.read<string>('openedUrls');
  }

  /**
   * Commands the mock had no answer for. A non-empty list means the app grew a
   * new desktop command and this runtime has not caught up: it is a real
   * finding, not test noise.
   */
  unhandled(): Promise<string[]> {
    return this.read<string>('unhandled');
  }

  /** Events the app emitted (panel intents, MCP replies, collab traffic). */
  emitted(): Promise<TauriEmittedEvent[]> {
    return this.read<TauriEmittedEvent>('emitted');
  }

  /** Block until the app issues `cmd`, then return that call. */
  async waitForCall(cmd: string, timeout = 15_000): Promise<TauriCall> {
    await this.page.waitForFunction(
      (name) => {
        const state = (window as unknown as { __E2E_TAURI__?: { calls: { cmd: string }[] } }).__E2E_TAURI__;
        return !!state?.calls.some((c) => c.cmd === name);
      },
      cmd,
      { timeout }
    );
    const matches = await this.callsTo(cmd);
    return matches[matches.length - 1];
  }

  /** Block until the app has written at least `count` files. */
  async waitForFiles(count = 1, timeout = 30_000): Promise<TauriWrittenFile[]> {
    await this.page.waitForFunction(
      (n) => {
        const state = (window as unknown as { __E2E_TAURI__?: { files: unknown[] } }).__E2E_TAURI__;
        return (state?.files.length ?? 0) >= n;
      },
      count,
      { timeout }
    );
    return this.files();
  }

  /** Point the native save dialog somewhere else, or make it cancel (`null`). */
  async setSavePath(path: string | null): Promise<void> {
    if (!this.enabled) return;
    await this.page.evaluate((value) => {
      const state = (window as unknown as { __E2E_TAURI__?: { config: { savePath: string | null } } }).__E2E_TAURI__;
      if (state) state.config.savePath = value;
    }, path);
  }

  /** Point the native folder picker somewhere else, or make it cancel. */
  async setOpenPath(path: string | null): Promise<void> {
    if (!this.enabled) return;
    await this.page.evaluate((value) => {
      const state = (window as unknown as { __E2E_TAURI__?: { config: { openPath: string | null } } }).__E2E_TAURI__;
      if (state) state.config.openPath = value;
    }, path);
  }

  /** Give one command a canned result for the rest of the test. */
  async setResponse(cmd: string, value: unknown): Promise<void> {
    if (!this.enabled) return;
    await this.page.evaluate((arg) => {
      const state = (window as unknown as { __E2E_TAURI__?: { config: { responses: Record<string, unknown> } } }).__E2E_TAURI__;
      if (state) state.config.responses[arg.cmd] = arg.value;
    }, { cmd, value });
  }

  /** Make one command reject, to exercise the app's desktop error paths. */
  async setError(cmd: string, message: string): Promise<void> {
    if (!this.enabled) return;
    await this.page.evaluate((arg) => {
      const state = (window as unknown as { __E2E_TAURI__?: { config: { errors: Record<string, string> } } }).__E2E_TAURI__;
      if (state) state.config.errors[arg.cmd] = arg.message;
    }, { cmd, message });
  }

  /** Deliver an event as though the Rust side had emitted it. */
  async emitFromBackend(event: string, payload: unknown): Promise<void> {
    if (!this.enabled) return;
    await this.page.evaluate(
      (arg) => {
        const state = (window as unknown as {
          __E2E_TAURI__?: { emitFromBackend: (e: string, p: unknown) => void };
        }).__E2E_TAURI__;
        state?.emitFromBackend(arg.event, arg.payload);
      },
      { event, payload }
    );
  }

  /** Forget every recorded call, file and URL. Config is left alone. */
  async reset(): Promise<void> {
    if (!this.enabled) return;
    await this.page.evaluate(() => {
      const state = (window as unknown as {
        __E2E_TAURI__?: { calls: unknown[]; files: unknown[]; openedUrls: unknown[]; unhandled: unknown[]; emitted: unknown[] };
      }).__E2E_TAURI__;
      if (!state) return;
      state.calls.length = 0;
      state.files.length = 0;
      state.openedUrls.length = 0;
      state.unhandled.length = 0;
      state.emitted.length = 0;
    });
  }
}
