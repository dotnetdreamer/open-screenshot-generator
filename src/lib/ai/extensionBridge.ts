/**
 * Client half of the companion browser extension protocol.
 *
 * The free mode reuses whatever Claude, ChatGPT or Gemini session the user is
 * already signed into. A page cannot read another origin's session, so the work
 * happens in the extension: a content script on our origin relays postMessage
 * traffic to a background worker, which opens the provider tab in the
 * background, types the prompt, attaches the screenshots, waits for the reply
 * and hands the text back. Artboard Studio never sees a cookie or a token, only
 * `{prompt, images} -> replyText`.
 *
 * When the extension is not installed, nothing here resolves and the UI falls
 * back to copy-prompt / paste-answer.
 */

export const PAGE_SOURCE = 'artboard-studio';
export const EXT_SOURCE = 'artboard-studio-extension';

export type WebProviderId = 'claude' | 'chatgpt' | 'gemini';

export interface WebProviderInfo {
  id: WebProviderId;
  label: string;
  url: string;
  host: string;
}

export const WEB_PROVIDERS: Record<WebProviderId, WebProviderInfo> = {
  claude: { id: 'claude', label: 'Claude', url: 'https://claude.ai/new', host: 'claude.ai' },
  chatgpt: { id: 'chatgpt', label: 'ChatGPT', url: 'https://chatgpt.com/', host: 'chatgpt.com' },
  gemini: {
    id: 'gemini',
    label: 'Gemini',
    url: 'https://gemini.google.com/app',
    host: 'gemini.google.com',
  },
};

export const WEB_PROVIDER_IDS = Object.keys(WEB_PROVIDERS) as WebProviderId[];

export interface BridgeImage {
  fileName: string;
  dataUrl: string;
}

export interface GenerateRequest {
  provider: WebProviderId;
  prompt: string;
  images: BridgeImage[];
}

export type BridgeStage =
  | 'opening'
  | 'attaching'
  | 'sending'
  | 'waiting'
  | 'reading';

export type BridgeErrorCode =
  | 'no-extension'
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
  'no-extension': 'The Artboard Studio companion extension is not installed or is disabled.',
  'not-logged-in': 'You are not signed in on that site. Sign in there, then run this again.',
  timeout: 'The assistant did not finish in time. It may still be typing. Try again, or use the manual steps below.',
  'site-changed': 'That site\'s layout changed and the extension could not drive it. Use the manual steps below.',
  cancelled: 'Cancelled.',
  unknown: 'The extension could not complete the request.',
};

let nextRequestId = 0;

function requestId(): string {
  return `abs_${Date.now()}_${nextRequestId++}`;
}

interface ExtensionMessage {
  source: typeof EXT_SOURCE;
  requestId: string;
  type: 'pong' | 'progress' | 'result' | 'error';
  stage?: BridgeStage;
  text?: string;
  code?: BridgeErrorCode;
  message?: string;
  version?: string;
}

function isExtensionMessage(data: unknown): data is ExtensionMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { source?: unknown }).source === EXT_SOURCE &&
    typeof (data as { requestId?: unknown }).requestId === 'string'
  );
}

/** Resolves with the extension version, or null if it does not answer in time. */
export function detectExtension(timeoutMs = 700): Promise<string | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const id = requestId();
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', onMessage);
      resolve(null);
    }, timeoutMs);

    function onMessage(event: MessageEvent) {
      if (event.source !== window || !isExtensionMessage(event.data)) return;
      if (event.data.requestId !== id || event.data.type !== 'pong') return;
      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve(event.data.version ?? 'unknown');
    }

    window.addEventListener('message', onMessage);
    window.postMessage({ source: PAGE_SOURCE, type: 'ping', requestId: id }, window.location.origin);
  });
}

export interface RunOptions {
  onStage?: (stage: BridgeStage) => void;
  signal?: AbortSignal;
  /** Chat replies can take a while, especially with several images attached. */
  timeoutMs?: number;
}

/** Drives the chosen site through the extension and resolves with its raw reply text. */
export function runViaExtension(
  request: GenerateRequest,
  options: RunOptions = {}
): Promise<string> {
  const { onStage, signal, timeoutMs = 5 * 60_000 } = options;

  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new BridgeError('no-extension', BRIDGE_ERROR_TEXT['no-extension']));
      return;
    }

    const id = requestId();
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new BridgeError('timeout', BRIDGE_ERROR_TEXT.timeout));
    }, timeoutMs);

    function cleanup() {
      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      signal?.removeEventListener('abort', onAbort);
    }

    function onAbort() {
      window.postMessage({ source: PAGE_SOURCE, type: 'cancel', requestId: id }, window.location.origin);
      cleanup();
      reject(new BridgeError('cancelled', BRIDGE_ERROR_TEXT.cancelled));
    }

    function onMessage(event: MessageEvent) {
      if (event.source !== window || !isExtensionMessage(event.data)) return;
      const message = event.data;
      if (message.requestId !== id) return;

      if (message.type === 'progress' && message.stage) {
        onStage?.(message.stage);
        return;
      }
      if (message.type === 'result') {
        cleanup();
        resolve(message.text ?? '');
        return;
      }
      if (message.type === 'error') {
        cleanup();
        const code = message.code ?? 'unknown';
        reject(new BridgeError(code, message.message || BRIDGE_ERROR_TEXT[code]));
      }
    }

    signal?.addEventListener('abort', onAbort);
    window.addEventListener('message', onMessage);
    window.postMessage(
      { source: PAGE_SOURCE, type: 'generate', requestId: id, payload: request },
      window.location.origin
    );
  });
}

export const BRIDGE_STAGE_TEXT: Record<BridgeStage, string> = {
  opening: 'Opening the assistant in a background tab',
  attaching: 'Attaching your screenshots',
  sending: 'Sending the prompt',
  waiting: 'Waiting for the reply',
  reading: 'Reading the answer',
};
