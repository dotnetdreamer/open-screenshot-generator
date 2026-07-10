import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

/**
 * Provider registry for the "use my API key" mode.
 *
 * Artboard Studio is a static export with no server, so every call is made from
 * the browser with the user's own key. All four providers serve CORS headers
 * for direct browser calls; Anthropic additionally requires an explicit opt-in
 * header, without which every request fails as an opaque network error.
 *
 * OpenRouter is the zero-cost option on the web: the key is free to create and
 * the listed models are its free tier. (The desktop app additionally offers a
 * keyless free mode; see freeProviders.ts.)
 */

export type AiProviderId = 'anthropic' | 'openai' | 'google' | 'openrouter';

export interface AiProviderInfo {
  id: AiProviderId;
  label: string;
  defaultModel: string;
  models: string[];
  keyPlaceholder: string;
  keyUrl: string;
  keyUrlLabel: string;
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
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    defaultModel: 'gpt-4o',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1'],
    keyPlaceholder: 'sk-...',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyUrlLabel: 'platform.openai.com',
  },
  google: {
    id: 'google',
    label: 'Google Gemini',
    defaultModel: 'gemini-2.5-flash',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro'],
    keyPlaceholder: 'AIza...',
    keyUrl: 'https://aistudio.google.com/app/apikey',
    keyUrlLabel: 'aistudio.google.com',
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
  },
};

export const AI_PROVIDER_IDS = Object.keys(AI_PROVIDERS) as AiProviderId[];

export function createModel(
  provider: AiProviderId,
  modelId: string,
  apiKey: string
): LanguageModel {
  switch (provider) {
    case 'anthropic':
      return createAnthropic({
        apiKey,
        // Anthropic blocks browser calls unless the caller opts in explicitly.
        headers: { 'anthropic-dangerous-direct-browser-access': 'true' },
      })(modelId);
    case 'openai':
      return createOpenAI({ apiKey })(modelId);
    case 'google':
      return createGoogleGenerativeAI({ apiKey })(modelId);
    case 'openrouter':
      // OpenRouter speaks the chat-completions dialect, not OpenAI's newer
      // Responses API that the default factory targets, hence .chat().
      return createOpenAI({ apiKey, baseURL: 'https://openrouter.ai/api/v1' }).chat(modelId);
  }
}

// --- settings persistence -------------------------------------------------

const STORAGE_KEY = 'artboard-studio.ai-settings';

export interface AiSettings {
  provider: AiProviderId;
  keys: Partial<Record<AiProviderId, string>>;
  models: Partial<Record<AiProviderId, string>>;
}

export const EMPTY_SETTINGS: AiSettings = { provider: 'anthropic', keys: {}, models: {} };

export function loadAiSettings(): AiSettings {
  if (typeof window === 'undefined') return EMPTY_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AiSettings>;
    const provider =
      parsed.provider && parsed.provider in AI_PROVIDERS ? parsed.provider : EMPTY_SETTINGS.provider;
    return {
      provider,
      keys: parsed.keys ?? {},
      models: parsed.models ?? {},
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

export function clearStoredKeys(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore.
  }
}
