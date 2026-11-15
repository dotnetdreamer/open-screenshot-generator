// Marketing copy translation through an AI the user already has: the Claude
// Code or Codex CLI they are signed in to (desktop), or the provider set up in
// the AI panel.
//
// LibreTranslate is a document translator pointed at advertising: it renders
// "Never break a streak" into something a native speaker rejects, and a rejected
// headline erases the whole reason for localized screenshots. A model that is
// told what the strings are for writes copy instead, which is why this exists
// beside src/services/translation.ts rather than replacing it.
//
// There is no new provider plumbing here. The transports the app already
// ships are reused as they are: the one-shot CLI prompt (agentPrompt.ts), the
// user's own API key, the desktop keyless providers, and the signed in
// assistant window. Every one of them answers with raw text, so there is a
// single parse path and no provider can drift into its own reply format.
//
// This file translates one chunk. Which AI gets which chunk, how big a chunk
// is and how many run at once is src/lib/i18n/engines.ts and translateRun.ts.

import { generateText } from 'ai';
import { isTauri } from '@/lib/desktop';
import { extractJsonCandidates } from './jsonExtract';
import { runAgentPrompt, type AgentWriter } from './agentPrompt';
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

/** Which AI a chunk goes to: one of the CLIs, or whatever the AI panel has set up. */
export type AiTranslator = { kind: 'agent'; agent: AgentWriter } | { kind: 'panel' };

export interface AiTranslateChunkRequest {
  items: Array<{ id: string; text: string }>;
  /** Shown to the model by name, so pass something a person would recognise. */
  targetLocale: string;
  /** Unset when nobody knows: the model works it out per string. */
  sourceLocale?: string;
  /** The user's own brief: terms to keep, tone, length limits. */
  guidance?: string;
  signal?: AbortSignal;
}

// --- the AI panel's transport --------------------------------------------------

type PanelTransport =
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

function resolveTransport(): PanelTransport | null {
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

/** True when the AI panel has a provider set up: a key, a local model, or an assistant window. */
export function isPanelAiAvailable(): boolean {
  return resolveTransport() !== null;
}

/**
 * How the AI panel's provider is reached, or null when none is set up. An API
 * key can take several requests at once; a model on this computer or an
 * assistant window answers one at a time.
 */
export function panelAiKind(): PanelTransport['kind'] | null {
  return resolveTransport()?.kind ?? null;
}

/** What the UI can name as the AI panel's provider. */
export function panelAiLabel(): string | null {
  const transport = resolveTransport();
  if (!transport) return null;
  if (transport.kind === 'api') {
    return `${describeEndpoint(transport.provider, transport.baseUrl)} (${transport.model})`;
  }
  if (transport.kind === 'free') return FREE_PROVIDERS[transport.provider].label;
  return WEB_PROVIDERS[transport.provider].label;
}

// --- prompt ------------------------------------------------------------------

function systemPrompt(targetLocale: string, sourceLocale?: string, guidance?: string): string {
  const rules = [
    sourceLocale
      ? `Translate from ${sourceLocale} into ${targetLocale}.`
      : `Translate into ${targetLocale}. Work out which language each string is written in.`,
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
 *
 * Exported for tests.
 */
export function readTranslations(reply: string, wanted: Set<string>): Record<string, string> {
  const out: Record<string, string> = {};

  const take = (id: unknown, value: unknown) => {
    if (typeof id !== 'string' || typeof value !== 'string') return;
    if (!wanted.has(id) || out[id] !== undefined) return;
    // Claude Code's prompt puts an invisible word joiner in front of an @ that
    // could name a file (once_input in claude_code.rs), and a model can copy
    // it into its answer, where it would sit inside the user's copy unseen.
    const trimmed = value.replace(/⁠(?=@)/g, '').trim();
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

async function runPanel(transport: PanelTransport, system: string, user: string, signal?: AbortSignal): Promise<string> {
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
      abortSignal: signal,
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
      signal,
    });
  }

  return runViaEmbeddedWebview({ provider: transport.provider, prompt, images: [] }, { signal });
}

/**
 * Translate one chunk and resolve with id -> translation. An id the model
 * dropped or mangled is simply absent, which is what lets the caller count
 * what actually landed instead of assuming the chunk was whole. Throws when
 * the AI could not be reached or refused, so the caller can hand the chunk to
 * the next one.
 */
export async function aiTranslateChunk(
  translator: AiTranslator,
  request: AiTranslateChunkRequest
): Promise<Record<string, string>> {
  const items = request.items.filter((item) => item.id && item.text && item.text.trim().length > 0);
  if (items.length === 0) return {};

  const system = systemPrompt(request.targetLocale, request.sourceLocale, request.guidance);
  const user = userPrompt(items);
  let reply: string;
  if (translator.kind === 'agent') {
    reply = await runAgentPrompt({
      agent: translator.agent,
      system,
      user,
      signal: request.signal,
      // Translating takes no reasoning, and at the CLI's default effort Codex
      // thinks about each chunk for far longer than it takes to write it.
      effort: translator.agent === 'codex' ? 'low' : undefined,
    });
  } else {
    const transport = resolveTransport();
    if (!transport) {
      throw new Error('No AI provider is set up. Add an API key in the AI panel');
    }
    reply = await runPanel(transport, system, user, request.signal);
  }
  return readTranslations(reply, new Set(items.map((item) => item.id)));
}

/**
 * One prompt through the AI panel's provider, answered as raw text. For the
 * growth feature's writing jobs (review replies, listing suggestions, report
 * summaries, questions about the numbers), which need the user's provider and
 * none of the chunking a translation does.
 */
export async function runAiPrompt(request: {
  system: string;
  user: string;
  signal?: AbortSignal;
  /** Passed to a free provider whose model can be asked to think less; the others ignore it. */
  effort?: 'low';
}): Promise<string> {
  const transport = resolveTransport();
  if (!transport) {
    throw new Error('No AI provider is set up. Add an API key in the AI panel, or a local model in Settings');
  }
  if (transport.kind === 'free') {
    const prompt = `${request.system}\n\n${request.user}`;
    return runFreeProvider({ provider: transport.provider, model: transport.model, prompt, images: [], signal: request.signal, effort: request.effort });
  }
  return runPanel(transport, request.system, request.user, request.signal);
}
