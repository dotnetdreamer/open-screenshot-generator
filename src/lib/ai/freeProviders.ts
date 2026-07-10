/**
 * Keyless "free mode" providers for the desktop app.
 *
 * Inspired by gpt4free's provider registry, with one deliberate difference: we
 * only ship endpoints that are free on purpose, so they do not break when a
 * vendor patches their site. Three flavors, all speaking the OpenAI
 * chat-completions dialect so a single transport drives every one of them:
 *
 *  - Pollinations: a free public cloud endpoint, no account, no key.
 *  - Ollama / LM Studio: local runtimes on this machine. The model runs on the
 *    user's own hardware, so it is free, private, and works offline.
 *
 * Every request goes straight from the user's machine to the provider. There
 * is no relay server anywhere. In the Tauri shell we route fetch through the
 * tauri-plugin-http bridge, which is not subject to CORS, so localhost
 * runtimes and any future keyless endpoint work without proxies. In a plain
 * browser this module still loads (window.fetch fallback) but the UI only
 * offers free mode on desktop.
 */

import { isTauri } from '@/lib/desktop';

export type FreeProviderId = 'pollinations' | 'ollama' | 'lmstudio';

export interface FreeProviderInfo {
  id: FreeProviderId;
  label: string;
  kind: 'cloud' | 'local';
  /** OpenAI-compatible chat completions endpoint. */
  chatUrl: string;
  /** Endpoint that lists available models. */
  modelsUrl: string;
  description: string;
  setupUrl?: string;
  setupUrlLabel?: string;
}

export const FREE_PROVIDERS: Record<FreeProviderId, FreeProviderInfo> = {
  pollinations: {
    id: 'pollinations',
    label: 'Pollinations (free cloud)',
    kind: 'cloud',
    chatUrl: 'https://text.pollinations.ai/openai',
    modelsUrl: 'https://text.pollinations.ai/models',
    description:
      'A free public AI service. No account and no key; requests go straight from this machine to text.pollinations.ai.',
  },
  ollama: {
    id: 'ollama',
    label: 'Ollama (local)',
    kind: 'local',
    chatUrl: 'http://127.0.0.1:11434/v1/chat/completions',
    modelsUrl: 'http://127.0.0.1:11434/v1/models',
    description:
      'Runs models on this machine. Free, private, works offline. For screenshots pull a vision model, for example "ollama pull llama3.2-vision".',
    setupUrl: 'https://ollama.com/download',
    setupUrlLabel: 'ollama.com',
  },
  lmstudio: {
    id: 'lmstudio',
    label: 'LM Studio (local)',
    kind: 'local',
    chatUrl: 'http://127.0.0.1:1234/v1/chat/completions',
    modelsUrl: 'http://127.0.0.1:1234/v1/models',
    description:
      'Runs models on this machine through LM Studio. Start its local server (Developer tab) and load a model first.',
    setupUrl: 'https://lmstudio.ai',
    setupUrlLabel: 'lmstudio.ai',
  },
};

export const FREE_PROVIDER_IDS = Object.keys(FREE_PROVIDERS) as FreeProviderId[];

export interface FreeModel {
  id: string;
  label: string;
  /** true = definitely sees images, false = definitely not, undefined = unknown. */
  vision?: boolean;
}

/** If the Pollinations model list cannot be read, this one is known to exist. */
const POLLINATIONS_FALLBACK_MODELS: FreeModel[] = [
  { id: 'openai-fast', label: 'openai-fast (GPT-OSS 20B)', vision: false },
];

export type FreeProviderErrorCode = 'not-running' | 'network' | 'http' | 'empty' | 'cancelled';

export class FreeProviderError extends Error {
  readonly code: FreeProviderErrorCode;
  constructor(code: FreeProviderErrorCode, message: string) {
    super(message);
    this.name = 'FreeProviderError';
    this.code = code;
  }
}

// --- transport --------------------------------------------------------------

/**
 * The Tauri HTTP bridge ignores CORS, which localhost runtimes need (they do
 * not send CORS headers for our origin). Dynamic import keeps the plugin out
 * of the web bundle, mirroring src/lib/desktop.ts.
 */
async function bridgeFetch(): Promise<typeof fetch> {
  if (isTauri()) {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
    return tauriFetch as typeof fetch;
  }
  return window.fetch.bind(window);
}

/** AbortSignal.any is too new for every WebView; combine signal + timeout by hand. */
function combineSignal(
  signal: AbortSignal | undefined,
  timeoutMs: number
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  const timer = setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), timeoutMs);
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort);
  }
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

function notRunningMessage(info: FreeProviderInfo): string {
  return info.kind === 'local'
    ? `${info.label.replace(/ \(local\)$/, '')} is not running on this machine. Start it, load a model, then press Refresh.`
    : `${info.label} could not be reached. Check your internet connection and try again.`;
}

// --- model discovery --------------------------------------------------------

/** Local model names that are known to accept images. Heuristic on purpose. */
const VISION_NAME_HINT = /llava|vision|vl\b|qwen2\.5vl|qwen3-vl|gemma3|moondream|pixtral|minicpm/i;

function toFreeModel(raw: unknown): FreeModel | null {
  if (typeof raw === 'string') {
    return { id: raw, label: raw, vision: VISION_NAME_HINT.test(raw) || undefined };
  }
  if (typeof raw === 'object' && raw !== null) {
    const record = raw as { name?: unknown; id?: unknown; vision?: unknown; description?: unknown };
    const id = typeof record.name === 'string' ? record.name : typeof record.id === 'string' ? record.id : null;
    if (!id) return null;
    const vision =
      typeof record.vision === 'boolean'
        ? record.vision
        : VISION_NAME_HINT.test(id) || undefined;
    const label =
      typeof record.description === 'string' && record.description && record.description !== id
        ? `${id} (${record.description})`
        : id;
    return { id, label, vision };
  }
  return null;
}

function sortVisionFirst(models: FreeModel[]): FreeModel[] {
  return [...models].sort((a, b) => Number(b.vision === true) - Number(a.vision === true));
}

export interface FreeProviderStatus {
  running: boolean;
  models: FreeModel[];
}

/**
 * Probe a provider and list its models. Local runtimes answer in a few
 * milliseconds when they are up, so a short timeout keeps the UI snappy.
 */
export async function detectFreeProvider(
  provider: FreeProviderId,
  signal?: AbortSignal
): Promise<FreeProviderStatus> {
  const info = FREE_PROVIDERS[provider];
  const doFetch = await bridgeFetch();
  const { signal: combined, dispose } = combineSignal(signal, info.kind === 'local' ? 2_500 : 8_000);

  let payload: unknown;
  try {
    const response = await doFetch(info.modelsUrl, { method: 'GET', signal: combined });
    // The host answered, so chat probably works even if the model listing is
    // broken or has changed shape; degrade to the known-good list rather than
    // reporting a working cloud provider as down.
    payload = await response.json().catch(() => null);
    if (!response.ok || payload === null) {
      return provider === 'pollinations'
        ? { running: true, models: POLLINATIONS_FALLBACK_MODELS }
        : { running: false, models: [] };
    }
  } catch {
    // Nothing answered: offline for the cloud provider, not running for the
    // local runtimes.
    return { running: false, models: [] };
  } finally {
    dispose();
  }

  // OpenAI shape {data: [...]} or a bare array (Pollinations).
  let list = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { data?: unknown })?.data)
      ? ((payload as { data: unknown[] }).data)
      : [];
  // Pollinations tags models with a tier; anything above "anonymous" needs a
  // registered token, which keyless mode does not have. The endpoint already
  // filters to the caller's tier today, but do not trust that to hold.
  list = list.filter((raw) => {
    const tier = (raw as { tier?: unknown })?.tier;
    return typeof tier !== 'string' || tier === 'anonymous';
  });
  const models = sortVisionFirst(list.map(toFreeModel).filter((m): m is FreeModel => m !== null));
  if (models.length === 0 && provider === 'pollinations') {
    return { running: true, models: POLLINATIONS_FALLBACK_MODELS };
  }
  return { running: models.length > 0, models };
}

// --- chat -------------------------------------------------------------------

export interface FreeGenerateArgs {
  provider: FreeProviderId;
  model: string;
  prompt: string;
  /** data: URLs, attached as OpenAI image_url parts. */
  images: string[];
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Send one prompt (plus screenshots) and resolve with the raw reply text. */
export async function runFreeProvider(args: FreeGenerateArgs): Promise<string> {
  const info = FREE_PROVIDERS[args.provider];
  const doFetch = await bridgeFetch();
  const { signal, dispose } = combineSignal(args.signal, args.timeoutMs ?? 5 * 60_000);

  const content =
    args.images.length === 0
      ? args.prompt
      : [
          { type: 'text', text: args.prompt },
          ...args.images.map((dataUrl) => ({ type: 'image_url', image_url: { url: dataUrl } })),
        ];

  let response: Response;
  try {
    response = await doFetch(info.chatUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        model: args.model,
        messages: [{ role: 'user', content }],
        stream: false,
      }),
    });
  } catch (error) {
    dispose();
    if (args.signal?.aborted) throw new FreeProviderError('cancelled', 'Cancelled.');
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new FreeProviderError(
        'network',
        'The model did not answer in time. Local models can be slow on the first request while they load; try again.'
      );
    }
    throw new FreeProviderError('not-running', notRunningMessage(info));
  }

  try {
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      throw new FreeProviderError(
        'http',
        response.status === 429
          ? 'The free service is rate limiting right now. Wait a moment and try again, or switch provider.'
          : `${info.label} returned an error (${response.status}). ${detail}`.trim()
      );
    }

    const reply = extractReplyText(await response.json().catch(() => null));
    if (!reply) {
      throw new FreeProviderError(
        'empty',
        'The model sent back an empty reply. Try again, or switch to a stronger model.'
      );
    }
    return reply;
  } finally {
    dispose();
  }
}

/** choices[0].message.content, tolerating servers that return content parts. */
function extractReplyText(payload: unknown): string {
  const message = (payload as { choices?: Array<{ message?: { content?: unknown } }> })
    ?.choices?.[0]?.message;
  const content = message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof (part as { text?: unknown })?.text === 'string' ? (part as { text: string }).text : ''))
      .join('')
      .trim();
  }
  return '';
}

// --- settings persistence ---------------------------------------------------

const STORAGE_KEY = 'artboard-studio.free-ai-settings';

export interface FreeAiSettings {
  provider: FreeProviderId;
  models: Partial<Record<FreeProviderId, string>>;
}

export const EMPTY_FREE_SETTINGS: FreeAiSettings = { provider: 'pollinations', models: {} };

export function loadFreeAiSettings(): FreeAiSettings {
  if (typeof window === 'undefined') return EMPTY_FREE_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_FREE_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<FreeAiSettings>;
    return {
      provider:
        parsed.provider && parsed.provider in FREE_PROVIDERS
          ? parsed.provider
          : EMPTY_FREE_SETTINGS.provider,
      models: parsed.models ?? {},
    };
  } catch {
    return EMPTY_FREE_SETTINGS;
  }
}

export function saveFreeAiSettings(settings: FreeAiSettings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private mode or a full quota. The choice just will not persist.
  }
}
