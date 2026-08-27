import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import { readWithLegacyFallback, removeWithLegacy } from '@/lib/legacyStorage';
import { looksLikeVisionModel } from './freeProviders';
import { bridgeFetch, combineSignal } from './httpBridge';

/**
 * Provider registry for the "use my API key" mode.
 *
 * Open Screenshot Generator is a static export with no server, so every call is made from
 * the browser with the user's own key. All four named providers serve CORS
 * headers for direct browser calls; Anthropic additionally requires an explicit
 * opt-in header, without which every request fails as an opaque network error.
 *
 * OpenRouter is the zero-cost option on the web: the key is free to create and
 * the listed models are its free tier. (The desktop app additionally offers a
 * keyless free mode; see freeProviders.ts.)
 *
 * The fifth entry, `compatible`, is the escape hatch: any endpoint that speaks
 * the OpenAI chat-completions dialect, named by the user. That is most of the
 * industry (MiniMax, DeepSeek, Groq, Together, Mistral, xAI, Moonshot, Z.ai,
 * Qwen, a self-hosted vLLM or a LiteLLM proxy), and it is the only way to reach
 * a provider we ship no preset for. Its requests go through the desktop HTTP
 * bridge, because a third party endpoint rarely sends CORS headers for our
 * origin and a blocked request looks exactly like an outage.
 */

export type AiProviderId = 'anthropic' | 'openai' | 'google' | 'openrouter' | 'compatible';

export interface AiProviderInfo {
  id: AiProviderId;
  label: string;
  defaultModel: string;
  models: string[];
  keyPlaceholder: string;
  keyUrl: string;
  keyUrlLabel: string;
  /** Where calls go when the user names no endpoint of their own. */
  defaultBaseUrl: string;
  /** The endpoint is the user's to name, and nothing works until they do. */
  requiresBaseUrl?: boolean;
  /** The model id is typed, not picked: the endpoint decides what it serves. */
  freeTextModel?: boolean;
}

export const AI_PROVIDERS: Record<AiProviderId, AiProviderInfo> = {
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic Claude',
    defaultModel: 'claude-opus-4-8',
    models: ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5'],
    keyPlaceholder: 'sk-ant-...',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyUrlLabel: 'console.anthropic.com',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    defaultModel: 'gpt-4o',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1'],
    keyPlaceholder: 'sk-...',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyUrlLabel: 'platform.openai.com',
    defaultBaseUrl: 'https://api.openai.com/v1',
  },
  google: {
    id: 'google',
    label: 'Google Gemini',
    defaultModel: 'gemini-2.5-flash',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro'],
    keyPlaceholder: 'AIza...',
    keyUrl: 'https://aistudio.google.com/app/apikey',
    keyUrlLabel: 'aistudio.google.com',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter (free models)',
    defaultModel: 'google/gemini-2.0-flash-exp:free',
    models: [
      'google/gemini-2.0-flash-exp:free',
      'meta-llama/llama-4-maverick:free',
      'qwen/qwen2.5-vl-72b-instruct:free',
    ],
    keyPlaceholder: 'sk-or-...',
    keyUrl: 'https://openrouter.ai/settings/keys',
    keyUrlLabel: 'openrouter.ai',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
  },
  compatible: {
    id: 'compatible',
    label: 'OpenAI compatible (any endpoint)',
    defaultModel: '',
    models: [],
    keyPlaceholder: 'sk-...',
    keyUrl: '',
    keyUrlLabel: '',
    defaultBaseUrl: '',
    requiresBaseUrl: true,
    freeTextModel: true,
  },
};

export const AI_PROVIDER_IDS = Object.keys(AI_PROVIDERS) as AiProviderId[];

// --- OpenAI-compatible endpoint presets -------------------------------------

export interface CompatiblePreset {
  id: string;
  label: string;
  /** Root of the OpenAI-compatible API, with no trailing /chat/completions. */
  baseUrl: string;
  /**
   * Model ids to offer before the endpoint has been asked. Suggestions only:
   * "Load models" reads the endpoint's own /models list, which is the truth.
   */
  models: string[];
  keyUrl?: string;
  keyUrlLabel?: string;
  /** Where to get the runtime itself, for a local server that has no keys. */
  setupUrl?: string;
  setupUrlLabel?: string;
  /** Runs on this machine, so there is usually no key and no internet. */
  local?: boolean;
}

/** The one preset that means "I will type the endpoint myself". */
export const CUSTOM_PRESET_ID = 'custom';

/**
 * Presets exist to save typing, never to gate anything: every field they fill
 * in stays editable, and an endpoint with no preset works exactly as well. Each
 * host below was probed for an OpenAI-compatible root (August 2026); the model
 * lists are opening suggestions, since ids churn faster than releases do.
 */
export const COMPATIBLE_PRESETS: CompatiblePreset[] = [
  {
    id: 'minimax',
    label: 'MiniMax',
    baseUrl: 'https://api.minimax.io/v1',
    models: ['MiniMax-M2', 'MiniMax-Text-01', 'MiniMax-VL-01'],
    keyUrl: 'https://platform.minimax.io/user-center/basic-information/interface-key',
    keyUrlLabel: 'platform.minimax.io',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    keyUrl: 'https://platform.deepseek.com/api_keys',
    keyUrlLabel: 'platform.deepseek.com',
  },
  {
    id: 'groq',
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: ['llama-3.3-70b-versatile', 'meta-llama/llama-4-maverick-17b-128e-instruct'],
    keyUrl: 'https://console.groq.com/keys',
    keyUrlLabel: 'console.groq.com',
  },
  {
    id: 'together',
    label: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
    models: ['meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8', 'Qwen/Qwen2.5-VL-72B-Instruct'],
    keyUrl: 'https://api.together.ai/settings/api-keys',
    keyUrlLabel: 'api.together.ai',
  },
  {
    id: 'mistral',
    label: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    models: ['mistral-large-latest', 'pixtral-large-latest'],
    keyUrl: 'https://console.mistral.ai/api-keys',
    keyUrlLabel: 'console.mistral.ai',
  },
  {
    id: 'xai',
    label: 'xAI (Grok)',
    baseUrl: 'https://api.x.ai/v1',
    models: ['grok-4', 'grok-2-vision-1212'],
    keyUrl: 'https://console.x.ai',
    keyUrlLabel: 'console.x.ai',
  },
  {
    id: 'moonshot',
    label: 'Moonshot (Kimi)',
    baseUrl: 'https://api.moonshot.ai/v1',
    models: ['kimi-k2-0905-preview', 'moonshot-v1-32k-vision-preview'],
    keyUrl: 'https://platform.moonshot.ai/console/api-keys',
    keyUrlLabel: 'platform.moonshot.ai',
  },
  {
    id: 'zai',
    label: 'Z.ai (GLM)',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    models: ['glm-4.6', 'glm-4.5v'],
    keyUrl: 'https://z.ai/manage-apikey/apikey-list',
    keyUrlLabel: 'z.ai',
  },
  {
    id: 'qwen',
    label: 'Alibaba Qwen (Model Studio)',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-max', 'qwen-vl-max'],
    keyUrl: 'https://bailian.console.alibabacloud.com',
    keyUrlLabel: 'bailian.console.alibabacloud.com',
  },
  {
    id: 'fireworks',
    label: 'Fireworks AI',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    models: ['accounts/fireworks/models/llama4-maverick-instruct-basic'],
    keyUrl: 'https://fireworks.ai/account/api-keys',
    keyUrlLabel: 'fireworks.ai',
  },
  {
    id: 'cerebras',
    label: 'Cerebras',
    baseUrl: 'https://api.cerebras.ai/v1',
    models: ['llama-3.3-70b', 'qwen-3-235b-a22b-instruct-2507'],
    keyUrl: 'https://cloud.cerebras.ai',
    keyUrlLabel: 'cloud.cerebras.ai',
  },
  {
    id: 'nebius',
    label: 'Nebius AI Studio',
    baseUrl: 'https://api.studio.nebius.com/v1',
    models: ['Qwen/Qwen2.5-VL-72B-Instruct', 'meta-llama/Llama-3.3-70B-Instruct'],
    keyUrl: 'https://studio.nebius.com/settings/api-keys',
    keyUrlLabel: 'studio.nebius.com',
  },
  {
    id: 'huggingface',
    label: 'Hugging Face router',
    baseUrl: 'https://router.huggingface.co/v1',
    models: ['Qwen/Qwen2.5-VL-72B-Instruct', 'meta-llama/Llama-3.3-70B-Instruct'],
    keyUrl: 'https://huggingface.co/settings/tokens',
    keyUrlLabel: 'huggingface.co',
  },
  {
    id: 'nvidia',
    label: 'NVIDIA NIM',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    models: ['meta/llama-4-maverick-17b-128e-instruct', 'microsoft/phi-4-multimodal-instruct'],
    keyUrl: 'https://build.nvidia.com',
    keyUrlLabel: 'build.nvidia.com',
  },
  {
    id: 'vercel',
    label: 'Vercel AI Gateway',
    baseUrl: 'https://ai-gateway.vercel.sh/v1',
    models: ['openai/gpt-4o', 'anthropic/claude-sonnet-4'],
    keyUrl: 'https://vercel.com/dashboard/ai-gateway/api-keys',
    keyUrlLabel: 'vercel.com',
  },
  {
    id: 'ollama',
    label: 'Ollama (this machine)',
    baseUrl: 'http://127.0.0.1:11434/v1',
    models: ['llama3.2-vision', 'qwen2.5vl'],
    setupUrl: 'https://ollama.com/download',
    setupUrlLabel: 'ollama.com',
    local: true,
  },
  {
    id: 'lmstudio',
    label: 'LM Studio (this machine)',
    baseUrl: 'http://127.0.0.1:1234/v1',
    models: [],
    setupUrl: 'https://lmstudio.ai',
    setupUrlLabel: 'lmstudio.ai',
    local: true,
  },
  {
    id: 'llamacpp',
    label: 'llama.cpp server (this machine)',
    baseUrl: 'http://127.0.0.1:8080/v1',
    models: [],
    local: true,
  },
  {
    id: 'vllm',
    label: 'vLLM (this machine)',
    baseUrl: 'http://127.0.0.1:8000/v1',
    models: [],
    local: true,
  },
  {
    id: 'litellm',
    label: 'LiteLLM proxy (this machine)',
    baseUrl: 'http://127.0.0.1:4000/v1',
    models: [],
    local: true,
  },
  {
    id: CUSTOM_PRESET_ID,
    label: 'Other, I will paste the URL',
    // No name to put in front of "API key": the endpoint speaks for itself.
    baseUrl: '',
    models: [],
  },
];

export function findCompatiblePreset(id: string | undefined): CompatiblePreset | null {
  if (!id) return null;
  return COMPATIBLE_PRESETS.find((preset) => preset.id === id) ?? null;
}

/** The preset whose endpoint the user is on, matched on the URL itself. */
export function presetForBaseUrl(baseUrl: string): CompatiblePreset | null {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) return null;
  return (
    COMPATIBLE_PRESETS.find(
      (preset) => preset.baseUrl && normalizeBaseUrl(preset.baseUrl) === normalized
    ) ?? null
  );
}

// --- endpoints --------------------------------------------------------------

/**
 * Hosts that are never on the public internet: this machine, a private LAN, or
 * an mDNS name. Nothing in that set serves TLS by default, so a scheme-less
 * entry for one of them means http.
 */
const PRIVATE_HOST =
  /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[?::1\]?|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|[^.]+\.local)$/i;

/** Only this machine. A LAN box is private, but it is not "this machine". */
const LOOPBACK_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?)$/i;

/** The host of a scheme-less entry, with any port and userinfo removed. */
function bareHost(url: string): string {
  const authority = url.split('/')[0];
  const host = authority.slice(authority.lastIndexOf('@') + 1);
  // Strip the port, but not the colons inside a bracketed IPv6 literal.
  return host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0];
}

/**
 * What a person pastes is rarely the base URL the SDK wants. They copy the full
 * chat endpoint out of a curl example, or the docs URL with its trailing slash,
 * or leave the scheme off entirely. All three mean the same thing.
 *
 * Credentials in the URL are dropped rather than carried: fetch refuses a URL
 * that holds them anyway, they would end up in the operation trace, and
 * "127.0.0.1@evil.example" is otherwise a remote host wearing a local face.
 */
export function normalizeBaseUrl(raw: string | undefined): string {
  let url = (raw ?? '').trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) {
    url = `${PRIVATE_HOST.test(bareHost(url)) ? 'http' : 'https'}://${url}`;
  }
  try {
    const parsed = new URL(url);
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    url = parsed.toString();
  } catch {
    // Not parseable as a URL. Hand it back as typed; the request that follows
    // will say so far more clearly than a silent rewrite would.
    return url;
  }
  url = url.replace(/\/+$/, '');
  url = url.replace(/\/(?:chat\/)?completions$/i, '');
  return url.replace(/\/+$/, '');
}

/** True for an endpoint served by this machine, which needs no key. */
export function isLocalEndpoint(baseUrl: string | undefined): boolean {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) return false;
  try {
    return LOOPBACK_HOST.test(new URL(normalized).hostname);
  } catch {
    return false;
  }
}

/** "api.minimax.io" out of a base URL, for labels and error messages. */
export function endpointHost(baseUrl: string | undefined): string {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) return '';
  try {
    return new URL(normalized).host;
  } catch {
    return normalized;
  }
}

// --- models -----------------------------------------------------------------

export interface CompatibleModel {
  id: string;
  /** true = the name says it reads images, undefined = no idea. */
  vision?: boolean;
}

/**
 * Ask an OpenAI-compatible endpoint what it serves. Everything about a custom
 * endpoint is unknown to us, model ids most of all, and typing one from memory
 * is the likeliest way to get a 404 that reads like an outage.
 */
export async function listCompatibleModels(args: {
  baseUrl: string;
  apiKey?: string;
  signal?: AbortSignal;
}): Promise<CompatibleModel[]> {
  const base = normalizeBaseUrl(args.baseUrl);
  if (!base) throw new Error('Enter the endpoint URL first.');

  // The timeout stays armed until the body has been read, not just until the
  // headers land: a proxy that answers 200 and then stalls the stream would
  // otherwise leave the caller waiting forever with its spinner running.
  const { signal, dispose } = combineSignal(args.signal, isLocalEndpoint(base) ? 4_000 : 12_000);
  const key = (args.apiKey ?? '').trim();

  try {
    let response: Response;
    try {
      response = await bridgeFetch(`${base}/models`, {
        method: 'GET',
        headers: key ? { Authorization: `Bearer ${key}` } : {},
        signal,
      });
    } catch {
      throw new Error(
        isLocalEndpoint(base)
          ? `Nothing answered at ${base}. Start the server, then try again.`
          : `Could not reach ${endpointHost(base)}. Check the URL and your connection.`
      );
    }

    if (!response.ok) {
      throw new Error(
        response.status === 401 || response.status === 403
          ? 'That key was rejected by this endpoint.'
          : `${endpointHost(base)} answered ${response.status} for /models. The endpoint may still work; type the model id yourself.`
      );
    }

    const payload: unknown = await response.json().catch(() => null);
    // OpenAI's {data: [...]}, or a bare array from the looser clones.
    const list: unknown[] = Array.isArray(payload)
      ? payload
      : Array.isArray((payload as { data?: unknown })?.data)
        ? (payload as { data: unknown[] }).data
        : [];
    const models: CompatibleModel[] = [];
    const seen = new Set<string>();
    for (const raw of list) {
      const id =
        typeof raw === 'string'
          ? raw
          : typeof (raw as { id?: unknown })?.id === 'string'
            ? (raw as { id: string }).id
            : null;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      models.push({ id, vision: looksLikeVisionModel(id) || undefined });
    }
    if (models.length === 0) {
      throw new Error(
        `${endpointHost(base)} listed no models. Type the model id yourself; the endpoint may still work.`
      );
    }
    // Anything that can read a screenshot is worth more here than anything that
    // cannot, so it goes to the top of the list.
    return models.sort((a, b) => Number(b.vision === true) - Number(a.vision === true));
  } finally {
    dispose();
  }
}
// --- model construction -----------------------------------------------------

export interface CreateModelArgs {
  provider: AiProviderId;
  model: string;
  apiKey: string;
  /** Overrides the provider's own endpoint. Required for `compatible`. */
  baseUrl?: string;
}

/**
 * A key is not always a key: local runtimes take any Authorization header, or
 * none at all, but the SDK refuses to build a model without one (a browser has
 * no process env for it to fall back on).
 */
const PLACEHOLDER_KEY = 'no-key-required';

export function createModel(args: CreateModelArgs): LanguageModel {
  const custom = normalizeBaseUrl(args.baseUrl);
  // A custom endpoint is called through the desktop HTTP bridge, which is not
  // subject to CORS. The named providers keep the browser's own fetch: their
  // hosts are the ones in capabilities/default.json, and they answer preflight.
  const fetchImpl = custom ? bridgeFetch : undefined;

  switch (args.provider) {
    case 'anthropic':
      return createAnthropic({
        apiKey: args.apiKey,
        baseURL: custom || undefined,
        // Anthropic blocks browser calls unless the caller opts in explicitly.
        headers: { 'anthropic-dangerous-direct-browser-access': 'true' },
        fetch: fetchImpl,
      })(args.model);
    case 'openai':
      // A custom endpoint here means a proxy or a clone, and those implement
      // chat completions far more often than OpenAI's newer Responses API that
      // the default factory targets, hence .chat() the moment one is set.
      return custom
        ? createOpenAI({ apiKey: args.apiKey, baseURL: custom, fetch: fetchImpl }).chat(args.model)
        : createOpenAI({ apiKey: args.apiKey })(args.model);
    case 'google':
      return createGoogleGenerativeAI({
        apiKey: args.apiKey,
        baseURL: custom || undefined,
        fetch: fetchImpl,
      })(args.model);
    case 'openrouter':
      // OpenRouter speaks the chat-completions dialect, not OpenAI's newer
      // Responses API that the default factory targets, hence .chat().
      return createOpenAI({
        apiKey: args.apiKey,
        baseURL: custom || AI_PROVIDERS.openrouter.defaultBaseUrl,
        fetch: fetchImpl,
      }).chat(args.model);
    case 'compatible':
      return createOpenAI({
        apiKey: args.apiKey.trim() || PLACEHOLDER_KEY,
        baseURL: custom,
        fetch: bridgeFetch,
      }).chat(args.model);
  }
}

// --- settings persistence ---------------------------------------------------

const STORAGE_KEY = 'open-screenshot-generator.ai-settings';

export interface AiSettings {
  provider: AiProviderId;
  keys: Partial<Record<AiProviderId, string>>;
  models: Partial<Record<AiProviderId, string>>;
  /** Endpoint override per provider. Required for `compatible`, optional elsewhere. */
  baseUrls: Partial<Record<AiProviderId, string>>;
  /**
   * Keys for custom endpoints, by host. `keys.compatible` would be one slot for
   * what is really any number of providers, so a key stored there would follow
   * the user to the next endpoint they typed and be sent to a stranger.
   */
  compatibleKeys: Record<string, string>;
}

export const EMPTY_SETTINGS: AiSettings = {
  provider: 'anthropic',
  keys: {},
  models: {},
  baseUrls: {},
  compatibleKeys: {},
};

export function loadAiSettings(): AiSettings {
  if (typeof window === 'undefined') return EMPTY_SETTINGS;
  try {
    const raw = readWithLegacyFallback(STORAGE_KEY);
    if (!raw) return EMPTY_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AiSettings>;
    const provider =
      parsed.provider && parsed.provider in AI_PROVIDERS ? parsed.provider : EMPTY_SETTINGS.provider;
    return {
      provider,
      keys: parsed.keys ?? {},
      models: parsed.models ?? {},
      // Settings written before custom endpoints existed carry neither of these.
      baseUrls: parsed.baseUrls ?? {},
      compatibleKeys: parsed.compatibleKeys ?? {},
    };
  } catch {
    return EMPTY_SETTINGS;
  }
}

export function saveAiSettings(settings: AiSettings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private mode or a full quota. Keys just will not persist.
  }
}

// --- what an endpoint wants -------------------------------------------------

/**
 * How a given endpoint wants a structured reply asked for. A JSON Schema is
 * worth more (the provider enforces the shape), but plenty of OpenAI-compatible
 * servers answer `response_format: json_schema` with a 400. Remembering the
 * verdict means only the first run against that endpoint pays for finding out.
 *
 * Keyed by endpoint AND model, because a gateway happily serves one model that
 * enforces schemas beside one that cannot. The negative verdict expires, so one
 * bad day at a provider does not pin it to the weaker path for good.
 */
export type ReplyMode = 'schema' | 'text';

const REPLY_MODE_PREFIX = 'agent-endpoint-json:';
const REPLY_MODE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function replyModeKey(baseUrl: string, model: string): string {
  return `${REPLY_MODE_PREFIX}${normalizeBaseUrl(baseUrl)}|${model.trim()}`;
}

export function readReplyMode(baseUrl: string, model: string): ReplyMode | null {
  if (typeof window === 'undefined' || !baseUrl) return null;
  try {
    const stored = window.localStorage.getItem(replyModeKey(baseUrl, model));
    if (!stored) return null;
    const [mode, stamp] = stored.split('|');
    if (mode === 'schema') return 'schema';
    if (mode !== 'text') return null;
    const age = Date.now() - Number(stamp);
    return Number.isFinite(age) && age < REPLY_MODE_TTL_MS ? 'text' : null;
  } catch {
    return null;
  }
}

export function rememberReplyMode(baseUrl: string, model: string, mode: ReplyMode): void {
  if (typeof window === 'undefined' || !baseUrl) return;
  try {
    window.localStorage.setItem(replyModeKey(baseUrl, model), `${mode}|${Date.now()}`);
  } catch {
    // Private mode or a full quota. The next run just probes again.
  }
}

function clearReplyModes(): void {
  if (typeof window === 'undefined') return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(REPLY_MODE_PREFIX)) doomed.push(key);
    }
    for (const key of doomed) window.localStorage.removeItem(key);
  } catch {
    // Nothing to clean up that we can reach.
  }
}

/** Forget every key, endpoint and endpoint verdict this machine has stored. */
export function clearStoredKeys(): void {
  removeWithLegacy(STORAGE_KEY);
  clearReplyModes();
}

// --- reading the settings back ----------------------------------------------

/** The endpoint a provider will be called on, '' meaning its own default. */
export function resolvedBaseUrl(settings: AiSettings, id: AiProviderId): string {
  return normalizeBaseUrl(settings.baseUrls[id]);
}

/** The stored key for one custom endpoint, which is per host, not per provider. */
export function endpointApiKey(settings: AiSettings, baseUrl: string | undefined): string {
  const host = endpointHost(baseUrl);
  return host ? (settings.compatibleKeys[host] ?? '').trim() : '';
}

/** The key a provider will be called with, wherever it happens to be stored. */
export function providerApiKey(settings: AiSettings, id: AiProviderId): string {
  return AI_PROVIDERS[id].requiresBaseUrl
    ? endpointApiKey(settings, resolvedBaseUrl(settings, id))
    : (settings.keys[id] || '').trim();
}

/**
 * Could a run start on this provider right now? A named provider needs a key.
 * A custom endpoint needs the endpoint and a model id too, and needs no key at
 * all when this machine is the one serving it.
 */
export function isProviderConfigured(settings: AiSettings, id: AiProviderId): boolean {
  const key = providerApiKey(settings, id);
  if (!AI_PROVIDERS[id].requiresBaseUrl) return key.length > 0;
  const base = resolvedBaseUrl(settings, id);
  const model = (settings.models[id] || '').trim();
  if (!base || !model) return false;
  return key.length > 0 || isLocalEndpoint(base);
}

/** What the UI names as the engine behind a run. */
export function providerLabel(settings: AiSettings, id: AiProviderId): string {
  return describeEndpoint(id, resolvedBaseUrl(settings, id));
}

/** The same, when all that is known is the endpoint a run actually used. */
export function describeEndpoint(id: AiProviderId, baseUrl: string | undefined): string {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return AI_PROVIDERS[id].label;
  const preset = presetForBaseUrl(base);
  if (preset && preset.id !== CUSTOM_PRESET_ID) return preset.label;
  return AI_PROVIDERS[id].requiresBaseUrl
    ? `OpenAI compatible (${endpointHost(base)})`
    : `${AI_PROVIDERS[id].label} via ${endpointHost(base)}`;
}
