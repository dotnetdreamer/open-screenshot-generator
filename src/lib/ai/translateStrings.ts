// Marketing copy translation through whichever AI provider the user already
// configured for the agent.
//
// LibreTranslate is a document translator pointed at advertising: it renders
// "Never break a streak" into something a native speaker rejects, and a rejected
// headline erases the whole reason for localized screenshots. A model that is
// told what the strings are for writes copy instead, which is why this exists
// beside src/services/translation.ts rather than replacing it.
//
// There is no new provider plumbing here. The three transports the agent
// already ships are reused as they are, in the order that costs the user least:
// their own API key, then the desktop keyless providers, then the signed in
// assistant window. Every one of them answers with raw text, so there is a
// single parse path and no provider can drift into its own reply format.

import { generateText } from 'ai';
import { isTauri } from '@/lib/desktop';
import { extractJsonCandidates } from './jsonExtract';
import {
  AI_PROVIDERS,
  AI_PROVIDER_IDS,
  createModel,
  describeEndpoint,
  isProviderConfigured,
  loadAiSettings,
  providerApiKey,
  resolvedBaseUrl,
  type AiProviderId,
} from './providers';
import {
  FREE_PROVIDERS,
  loadFreeAiSettings,
  runFreeProvider,
  type FreeProviderId,
} from './freeProviders';
import { runViaEmbeddedWebview } from './webSessionDesktop';
import { WEB_PROVIDERS, type WebProviderId } from './webAdapters';

export interface AiTranslateRequest {
  items: Array<{ id: string; text: string }>;
  /** Shown to the model by name, so pass something a person would recognise. */
  targetLocale: string;
  sourceLocale: string;
  /** The user's own brief: terms to keep, tone, length limits. */
  guidance?: string;
  signal?: AbortSignal;
  /** Fires once per chunk. Long runs are several requests, not one. */
  onProgress?: (done: number, total: number) => void;
}

/**
 * A chunk is small enough that a local 8B model with a modest context window
 * answers it, and small enough that one failure costs a handful of strings
 * rather than the whole project.
 */
const MAX_CHUNK_ITEMS = 25;
const MAX_CHUNK_CHARS = 2500;

// --- transport selection -----------------------------------------------------

type Transport =
  | {
      kind: 'api';
      provider: AiProviderId;
      model: string;
      apiKey: string;
      /** The endpoint the user named, or empty for the provider default. */
      baseUrl: string;
    }
  | { kind: 'free'; provider: FreeProviderId; model: string }
  | { kind: 'web'; provider: WebProviderId };

const WEB_PROVIDER_KEY = 'open-screenshot-generator.translate-assistant';

/**
 * Which signed in assistant window may be driven for translations, if the user
 * picked one. Deliberately opt in: the other two transports are a quiet HTTP
 * request, this one opens a browser window and may stop to ask for a password,
 * so it never happens because a default said so.
 */
export function getAiTranslateWebProvider(): WebProviderId | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(WEB_PROVIDER_KEY);
    return stored && stored in WEB_PROVIDERS ? (stored as WebProviderId) : null;
  } catch {
    return null;
  }
}

export function setAiTranslateWebProvider(provider: WebProviderId | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (provider) window.localStorage.setItem(WEB_PROVIDER_KEY, provider);
    else window.localStorage.removeItem(WEB_PROVIDER_KEY);
  } catch {
    // Private mode. The choice just will not persist.
  }
}

function resolveTransport(): Transport | null {
  const settings = loadAiSettings();
  // The selected provider first, then any other one that is still set up, so
  // a user who switched the picker to try a provider they never keyed does not
  // lose the path they already had. "Set up" is more than a key for a custom
  // endpoint: it needs the URL and a model id too, and a local one needs no key.
  const ready = [settings.provider, ...AI_PROVIDER_IDS].find(
    (id) =>
      isProviderConfigured(settings, id) &&
      // Pasting a key is an explicit act; a keyless local endpoint is not. So a
      // custom endpoint with no key is only the engine while it is the one the
      // user has picked, or one experiment with Ollama would quietly own every
      // translation from then on.
      (id === settings.provider || providerApiKey(settings, id).length > 0)
  );
  if (ready) {
    return {
      kind: 'api',
      provider: ready,
      model: settings.models[ready] || AI_PROVIDERS[ready].defaultModel,
      apiKey: providerApiKey(settings, ready),
      baseUrl: resolvedBaseUrl(settings, ready),
    };
  }

  // Everything below runs models on this machine or in an in-app window, which
  // only the desktop shell has. isTauri() is false during SSR and the first
  // client render, so anything rendering off this must wait for mount.
  if (!isTauri()) return null;

  const free = loadFreeAiSettings();
  const freeModel = free.models[free.provider];
  if (freeModel) return { kind: 'free', provider: free.provider, model: freeModel };

  const web = getAiTranslateWebProvider();
  if (web) return { kind: 'web', provider: web };

  return null;
}

/** True when a translation run would have something to send the strings to. */
export function isAiTranslateAvailable(): boolean {
  return resolveTransport() !== null;
}

/** What the UI can name as the engine behind "Translate with AI". */
export function aiTranslateTransportLabel(): string | null {
  const transport = resolveTransport();
  if (!transport) return null;
  if (transport.kind === 'api') {
    return `${describeEndpoint(transport.provider, transport.baseUrl)} (${transport.model})`;
  }
  if (transport.kind === 'free') return FREE_PROVIDERS[transport.provider].label;
  return WEB_PROVIDERS[transport.provider].label;
}

// --- prompt ------------------------------------------------------------------

function systemPrompt(sourceLocale: string, targetLocale: string, guidance?: string): string {
  const rules = [
    `Translate from ${sourceLocale} into ${targetLocale}.`,
    'This is App Store and Google Play marketing copy printed on a screenshot, not documentation. Write what a native speaker would put on the poster, not a literal rendering.',
    'Keep brand names, product names and interface labels that ship untranslated exactly as they are.',
    'Match the tone, the capitalisation style and the punctuation of the source.',
    'Keep every string about as short as the source. A caption that grows by half no longer fits the screenshot.',
    'Never add notes, explanations, quotes, or anything the source does not say.',
    'When a string is already correct in the target language, return it unchanged.',
  ];
  if (guidance && guidance.trim()) {
    rules.push(`Follow this brief from the person who wrote the copy: ${guidance.trim()}`);
  }
  return [
    'You translate short marketing strings for app store screenshots.',
    ...rules.map((rule) => `- ${rule}`),
    'Answer with one JSON object mapping each id to its translated string, and nothing else.',
  ].join('\n');
}

function userPrompt(items: Array<{ id: string; text: string }>): string {
  const payload = items.map((item) => `${JSON.stringify(item.id)}: ${JSON.stringify(item.text)}`);
  return ['Translate each of these strings:', '{', payload.join(',\n'), '}'].join('\n');
}

// --- reply parsing -----------------------------------------------------------

/**
 * Chat models wrap answers in fences, in prose, and sometimes in one more
 * object than they were asked for, so every plausible shape is tried and only
 * ids we asked about survive. A hallucinated id is a string that would be
 * written onto an element that does not exist.
 */
function readTranslations(reply: string, wanted: Set<string>): Record<string, string> {
  const out: Record<string, string> = {};

  const take = (id: unknown, value: unknown) => {
    if (typeof id !== 'string' || typeof value !== 'string') return;
    if (!wanted.has(id) || out[id] !== undefined) return;
    const trimmed = value.trim();
    if (trimmed) out[id] = trimmed;
  };

  const harvest = (value: unknown, depth: number): void => {
    if (!value || typeof value !== 'object' || depth > 3) return;
    if (Array.isArray(value)) {
      for (const entry of value) {
        const record = entry as { id?: unknown; text?: unknown; translation?: unknown; value?: unknown };
        if (record && typeof record === 'object') {
          take(record.id, record.translation ?? record.text ?? record.value);
        }
      }
      return;
    }
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (typeof entry === 'string') take(key, entry);
      // A wrapper such as {"translations": {...}} is common enough that
      // rejecting the whole reply over it would be the wrong trade.
      else harvest(entry, depth + 1);
    }
  };

  for (const candidate of extractJsonCandidates(reply)) {
    harvest(candidate, 0);
    if (Object.keys(out).length >= wanted.size) break;
  }
  return out;
}

// --- running -----------------------------------------------------------------

async function runChunk(
  transport: Transport,
  items: Array<{ id: string; text: string }>,
  request: AiTranslateRequest
): Promise<string> {
  const system = systemPrompt(request.sourceLocale, request.targetLocale, request.guidance);
  const user = userPrompt(items);

  if (transport.kind === 'api') {
    const result = await generateText({
      model: createModel({
        provider: transport.provider,
        model: transport.model,
        apiKey: transport.apiKey,
        baseUrl: transport.baseUrl,
      }),
      // `system` as a message field is rejected by the SDK; this is the
      // supported channel for it.
      instructions: system,
      prompt: user,
      abortSignal: request.signal,
    });
    return result.text;
  }

  // The other two transports take a single prompt, so the rules ride along in
  // it rather than in a system message they have nowhere to put.
  const prompt = `${system}\n\n${user}`;

  if (transport.kind === 'free') {
    return runFreeProvider({
      provider: transport.provider,
      model: transport.model,
      prompt,
      images: [],
      signal: request.signal,
    });
  }

  return runViaEmbeddedWebview(
    { provider: transport.provider, prompt, images: [] },
    { signal: request.signal }
  );
}

function chunkItems(items: Array<{ id: string; text: string }>): Array<Array<{ id: string; text: string }>> {
  const chunks: Array<Array<{ id: string; text: string }>> = [];
  let current: Array<{ id: string; text: string }> = [];
  let chars = 0;
  for (const item of items) {
    if (current.length > 0 && (current.length >= MAX_CHUNK_ITEMS || chars + item.text.length > MAX_CHUNK_CHARS)) {
      chunks.push(current);
      current = [];
      chars = 0;
    }
    current.push(item);
    chars += item.text.length;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * Translate the given strings and resolve with id -> translation. An id the
 * model dropped or mangled is simply absent, which is what lets the caller
 * count what actually landed instead of assuming the run was whole.
 *
 * Throws when there is no configured provider and when the very first chunk
 * fails (a rejected key or a model that is not there fails the same way for
 * every chunk, so hammering it wastes the user's time). A later chunk failing,
 * or a cancel, stops the run and keeps everything already translated.
 */
export async function aiTranslateStrings(req: AiTranslateRequest): Promise<Record<string, string>> {
  const items = req.items.filter((item) => item.id && item.text && item.text.trim().length > 0);
  if (items.length === 0) return {};

  const transport = resolveTransport();
  if (!transport) {
    throw new Error(
      'No AI provider is set up. Add an API key in the AI panel, or use the machine translation engine.'
    );
  }

  const out: Record<string, string> = {};
  const chunks = chunkItems(items);
  let done = 0;

  for (const chunk of chunks) {
    if (req.signal?.aborted) break;
    try {
      const reply = await runChunk(transport, chunk, req);
      Object.assign(out, readTranslations(reply, new Set(chunk.map((item) => item.id))));
    } catch (error) {
      // A cancelled run keeps what it already translated: the strings are
      // written either way, and throwing them away is the one outcome nobody
      // asked for.
      if (req.signal?.aborted) break;
      if (Object.keys(out).length === 0) throw error;
      console.error('AI translation stopped after a failed batch', error);
      break;
    }
    done += chunk.length;
    req.onProgress?.(done, items.length);
  }

  return out;
}
