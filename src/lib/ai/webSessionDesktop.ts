/**
 * Desktop transport for the "Free, use my account" mode.
 *
 * The desktop app opens each provider (Claude, ChatGPT, Gemini, ...) in its own
 * in-app window (WebView2 / WKWebView), the user signs in there once, and the
 * Rust shell drives that window with the injected agent (webAssistantAgent.ts).
 * This module is the thin client for that: it calls the Rust commands and
 * listens for the agent's events. Only `{prompt, images} -> replyText` crosses
 * back; the provider's cookies never leave that window.
 *
 * Whether the window stays hidden while it works or is shown is the user's
 * choice, made in the native Settings menu and handled entirely on the Rust
 * side (src-tauri/src/settings.rs).
 */

import { isTauri } from '@/lib/desktop';
import { WEB_EVENT_CHANNEL, type WebProviderId } from './webAdapters';
import type { OperationRecorder } from './operationLog';

export interface BridgeImage {
  fileName: string;
  dataUrl: string;
}

export interface GenerateRequest {
  provider: WebProviderId;
  prompt: string;
  images: BridgeImage[];
}

/** Progress checkpoints the injected agent reports while driving the site. */
export type BridgeStage = 'opening' | 'login' | 'attaching' | 'sending' | 'waiting' | 'reading';

export const BRIDGE_STAGE_TEXT: Record<BridgeStage, string> = {
  opening: 'Opening the assistant window',
  login: 'Waiting for you to sign in',
  attaching: 'Attaching your screenshots',
  sending: 'Sending the prompt',
  waiting: 'Waiting for the reply',
  reading: 'Reading the answer',
};

export type BridgeErrorCode =
  | 'not-logged-in'
  | 'timeout'
  | 'site-changed'
  | 'cancelled'
  | 'unknown';

export class BridgeError extends Error {
  readonly code: BridgeErrorCode;
  constructor(code: BridgeErrorCode, message: string) {
    super(message);
    this.name = 'BridgeError';
    this.code = code;
  }
}

export const BRIDGE_ERROR_TEXT: Record<BridgeErrorCode, string> = {
  'not-logged-in': 'You are not signed in on that site. Sign in in the assistant window and the run continues by itself.',
  timeout: 'The assistant did not finish in time. It may still be typing. Try again.',
  'site-changed':
    "That site's layout changed and the assistant could not drive it. Try another provider.",
  cancelled: 'Cancelled.',
  unknown: 'The assistant could not complete the request.',
};

export interface RunOptions {
  onStage?: (stage: BridgeStage) => void;
  signal?: AbortSignal;
  /** Chat replies can take a while, especially with several images attached. */
  timeoutMs?: number;
  /**
   * When present, the run records its timeline into this operation: every
   * stage, a screenshot of the provider window at each step, sign-in prompts,
   * and the agent's own errors. The caller still records the prompt it sent and
   * the reply it got back (it is the one that has them).
   */
  recorder?: OperationRecorder;
}

/**
 * Capture the provider window as a screenshot (PNG), downscaled to a compact
 * JPEG data URL. Returns null off-desktop, if the window is not open, or on any
 * failure: a screenshot is a nice-to-have for the timeline, never load-bearing.
 */
export async function captureProviderScreenshot(provider: WebProviderId): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const pngDataUrl = await invoke<string>('abs_web_capture', { provider });
    if (typeof pngDataUrl !== 'string' || !pngDataUrl.startsWith('data:')) return null;
    return await downscaleDataUrl(pngDataUrl);
  } catch {
    return null;
  }
}

/** Shrink a screenshot so a run's worth of them stays small in IndexedDB. */
function downscaleDataUrl(src: string, maxDim = 1000, quality = 0.7): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      try {
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(src);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch {
        resolve(src); // tainted canvas or no 2d context: keep the original PNG
      }
    };
    img.onerror = () => resolve(src);
    img.src = src;
  });
}

/**
 * Capture one screenshot per provider at a time and file it into the recorder.
 * Serialised so several stage checkpoints firing close together do not ask
 * WebView2 for overlapping CapturePreviews. Fire-and-forget: the timeline entry
 * is stamped with `t` (when the capture was requested) so it sorts correctly
 * even though the image resolves later.
 */
const captureQueues = new Map<string, Promise<unknown>>();
function recordScreenshot(
  recorder: OperationRecorder | undefined,
  provider: WebProviderId,
  label: string
): void {
  if (!recorder) return;
  const t = Date.now();
  const prev = captureQueues.get(provider) ?? Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(() => captureProviderScreenshot(provider))
    .then((url) => {
      if (url) recorder.screenshot(url, label, t);
    });
  captureQueues.set(provider, next.catch(() => {}));
}

/** Events the injected agent (webAssistantAgent.ts) emits. */
interface AgentEvent {
  type: 'ready' | 'progress' | 'result' | 'error' | 'need-login';
  requestId: string;
  provider: WebProviderId;
  stage?: BridgeStage;
  text?: string;
  code?: string;
  message?: string;
  loggedIn?: boolean;
}

let nextId = 0;
function requestId(): string {
  return `abs_web_${Date.now()}_${nextId++}`;
}

/** The desktop embedded-webview path is only available inside the Tauri shell. */
export function embeddedWebviewAvailable(): boolean {
  return isTauri();
}

/** Reveal a provider window so the user can sign in before running anything. */
export async function loginToProvider(provider: WebProviderId): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('abs_web_login', { provider });
}

/** Close a provider window and its automated session. */
export async function closeProviderWindow(provider: WebProviderId): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('abs_web_close', { provider });
}

/**
 * Drive the chosen provider through its in-app window and resolve with the raw
 * reply text. Rejects with a BridgeError.
 */
export async function runViaEmbeddedWebview(
  request: GenerateRequest,
  options: RunOptions = {}
): Promise<string> {
  const { onStage, signal, timeoutMs = 5 * 60_000, recorder } = options;
  const { provider } = request;
  const { invoke } = await import('@tauri-apps/api/core');
  const { listen } = await import('@tauri-apps/api/event');

  const id = requestId();

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let unlisten: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let startInvoked: Promise<unknown> = Promise.resolve();

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      unlisten?.();
      signal?.removeEventListener('abort', onAbort);
    };
    // Never let the cancel overtake a still-running abs_web_start: arriving
    // first it would find no queued job to remove, and the job would then run
    // as a ghost in the hidden window after the UI already gave up.
    const cancelOnShell = () => {
      startInvoked
        .catch(() => {})
        .then(() => invoke('abs_web_cancel', { requestId: id }))
        .catch(() => {});
    };
    const startTimer = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        cancelOnShell();
        finish(() => reject(new BridgeError('timeout', BRIDGE_ERROR_TEXT.timeout)));
      }, timeoutMs);
    };
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };

    function onAbort() {
      cancelOnShell();
      finish(() => reject(new BridgeError('cancelled', BRIDGE_ERROR_TEXT.cancelled)));
    }

    const images: BridgeImage[] = request.images;

    void listen<AgentEvent>(WEB_EVENT_CHANNEL, (event) => {
      const msg = event.payload;
      if (msg.requestId !== id) return;
      if (msg.type === 'progress' && msg.stage) {
        // Each stage transition gets a fresh clock. Without this, a run that
        // resumed after a slow sign-in would still count the sign-in time
        // against the reply and get killed mid-stream.
        startTimer();
        recorder?.stage(msg.stage, BRIDGE_STAGE_TEXT[msg.stage]);
        recordScreenshot(recorder, provider, BRIDGE_STAGE_TEXT[msg.stage]);
        onStage?.(msg.stage);
      } else if (msg.type === 'need-login' || (msg.type === 'error' && msg.code === 'not-logged-in')) {
        // Rust has revealed the window for a manual sign-in and keeps the job
        // queued; once the user logs in, the run continues by itself. Restart
        // the clock so the time spent typing a password is not held against
        // the reply.
        startTimer();
        recorder?.note('Sign-in required in the assistant window');
        recordScreenshot(recorder, provider, 'Sign-in screen');
        onStage?.('login');
      } else if (msg.type === 'result') {
        recordScreenshot(recorder, provider, 'Final reply on screen');
        finish(() => resolve(msg.text ?? ''));
      } else if (msg.type === 'error') {
        const code = (msg.code as BridgeError['code']) ?? 'unknown';
        recorder?.message('provider-to-app', `Assistant reported an error (${code})`, {
          detail: msg.message,
          code,
        });
        recordScreenshot(recorder, provider, 'Error state');
        finish(() => reject(new BridgeError(code, msg.message || BRIDGE_ERROR_TEXT[code] || BRIDGE_ERROR_TEXT.unknown)));
      }
    })
      .then((fn) => {
        unlisten = fn;
        if (settled) {
          // Aborted or finished before the listener attached; drop it.
          fn();
          return;
        }
        recorder?.stage('opening', BRIDGE_STAGE_TEXT.opening);
        onStage?.('opening');
        startInvoked = invoke('abs_web_start', {
          provider: request.provider,
          requestId: id,
          prompt: request.prompt,
          images,
        });
        return startInvoked;
      })
      .catch((error: unknown) => {
        finish(() =>
          reject(
            new BridgeError(
              'unknown',
              error instanceof Error ? error.message : 'The assistant window could not be opened.'
            )
          )
        );
      });

    signal?.addEventListener('abort', onAbort);
    startTimer();
  });
}
