/**
 * Message shapes shared by the page bridge, the background worker and the site
 * adapters. Mirrors src/lib/ai/extensionBridge.ts on the web app side; keep the
 * two in sync.
 */

export const PAGE_SOURCE = 'artboard-studio';
export const EXT_SOURCE = 'artboard-studio-extension';

// The provider list is shared with the app so the two never drift.
export type { WebProviderId } from '../../src/lib/ai/webAdapters';
import type { WebProviderId } from '../../src/lib/ai/webAdapters';

export type Stage = 'opening' | 'attaching' | 'sending' | 'waiting' | 'reading';

export type ErrorCode =
  | 'no-extension'
  | 'not-logged-in'
  | 'timeout'
  | 'site-changed'
  | 'cancelled'
  | 'unknown';

export interface BridgeImage {
  fileName: string;
  dataUrl: string;
}

/** page -> bridge -> background */
export type PageMessage =
  | { source: typeof PAGE_SOURCE; type: 'ping'; requestId: string }
  | { source: typeof PAGE_SOURCE; type: 'cancel'; requestId: string }
  | {
      source: typeof PAGE_SOURCE;
      type: 'generate';
      requestId: string;
      payload: { provider: WebProviderId; prompt: string; images: BridgeImage[] };
    };

/** background -> bridge -> page */
export type ExtMessage =
  | { source: typeof EXT_SOURCE; type: 'pong'; requestId: string; version: string }
  | { source: typeof EXT_SOURCE; type: 'progress'; requestId: string; stage: Stage }
  | { source: typeof EXT_SOURCE; type: 'result'; requestId: string; text: string }
  | { source: typeof EXT_SOURCE; type: 'error'; requestId: string; code: ErrorCode; message: string };

/** background -> adapter content script */
export interface RunCommand {
  type: 'abs-run';
  requestId: string;
  prompt: string;
  images: BridgeImage[];
}

export interface CancelCommand {
  type: 'abs-cancel';
  requestId: string;
}

/** adapter -> background */
export type AdapterMessage =
  | { type: 'abs-progress'; requestId: string; stage: Stage }
  | { type: 'abs-result'; requestId: string; text: string }
  | { type: 'abs-error'; requestId: string; code: ErrorCode; message: string };

export type RunResponse =
  | { ok: true; text: string }
  | { ok: false; code: ErrorCode; message: string };
