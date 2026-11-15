// Who translates the text on the artboards, best first: the Claude Code or
// Codex the user is signed in to (desktop), then the provider set up in the
// AI panel. Our LibreTranslate server translates only for a user who has
// none of those.
//
// The server is one instance shared by every user and allows a few requests a
// minute, so it is never a fallback for a user with an AI of their own: when
// their Claude Code fails, Codex or the AI panel takes over, and when none of
// them can, the user is told why. An engine of the user's own also takes
// bigger chunks, several at once (engineLimits), which is what makes ten
// languages a matter of seconds.

import { isTauri } from '@/lib/desktop';
import {
  AGENT_PROMPTS_AT_ONCE,
  agentDetectedAt,
  detectAgentWriters,
  knownAgentWriters,
  onAgentWritersDetected,
} from '@/lib/ai/agentPrompt';
import { aiTranslateChunk, isPanelAiAvailable, panelAiKind, panelAiLabel } from '@/lib/ai/translateStrings';
import { AUTO_DETECT, isTranslationEnabled, translateTexts } from '@/services/translation';

/**
 * 'claude' and 'codex' are the CLIs on the user's own sign-in, which bills
 * their plan or, for a login with an API key, that key. 'ai' is the AI panel's
 * provider, 'libre' is our server.
 */
export type TranslateEngine = 'claude' | 'codex' | 'ai' | 'libre';

/** Best first. */
export const ENGINE_ORDER: readonly TranslateEngine[] = ['claude', 'codex', 'ai', 'libre'];

export function isEngineReady(engine: TranslateEngine): boolean {
  switch (engine) {
    case 'claude':
    case 'codex':
      return knownAgentWriters()?.[engine].ready === true;
    case 'ai':
      return isPanelAiAvailable();
    case 'libre':
      return isTranslationEnabled;
  }
}

/**
 * The engines a run would use now, best first, going by what is known this
 * moment: the user's own AIs, or our server alone when they have none. Claude
 * Code and Codex count only once a detect has found them, so code that can
 * wait calls resolveEngines instead.
 */
export function availableEngines(): TranslateEngine[] {
  const ready = ENGINE_ORDER.filter(isEngineReady);
  const own = ready.filter(isOwnEngine);
  return own.length > 0 ? own : ready;
}

/** How old a look that found neither CLI ready may be before a run looks again. */
const RECHECK_MS = 60_000;

/**
 * Engines that would work now, best first, once Claude Code and Codex have
 * been looked for. On the desktop the first call in a window waits for that
 * (a second or two). Later calls answer at once, unless the last look found
 * neither CLI ready and is over a minute old: someone who has just signed in
 * to Claude Code in a terminal gets it on their next run.
 */
export async function resolveEngines(): Promise<TranslateEngine[]> {
  if (isTauri()) {
    try {
      await detectAgentWriters();
      const known = knownAgentWriters();
      const oldest = Math.min(agentDetectedAt('claude'), agentDetectedAt('codex'));
      if (!known?.claude.ready && !known?.codex.ready && Date.now() - oldest > RECHECK_MS) {
        await detectAgentWriters({ refresh: true });
      }
    } catch (error) {
      console.error('Looking for Claude Code and Codex failed', error);
    }
  }
  return availableEngines();
}

/** Look for Claude Code and Codex as a run would, without waiting for the answer. */
export function detectTranslateEngines(): void {
  if (!isTauri()) return;
  void resolveEngines();
}

/** Called when what can translate may have changed. Returns the function that stops it. */
export function onTranslateEnginesChange(listener: () => void): () => void {
  return onAgentWritersDetected(listener);
}

/** True for an engine on the user's own sign-in or key, false for our shared server. */
export function isOwnEngine(engine: TranslateEngine): boolean {
  return engine !== 'libre';
}

/** The engine's name as it reads after "with", e.g. "Claude Code (Max plan)". */
export function engineLabel(engine: TranslateEngine): string {
  switch (engine) {
    case 'claude':
      return knownAgentWriters()?.claude.label ?? 'Claude Code';
    case 'codex':
      return knownAgentWriters()?.codex.label ?? 'Codex';
    case 'ai':
      return panelAiLabel() ?? 'the AI panel';
    case 'libre':
      return "the app's free translator";
  }
}

export interface EngineLimits {
  /** The most strings, and characters, one request carries. */
  chunkItems: number;
  chunkChars: number;
  /** Requests in flight at once. */
  atOnce: number;
}

export function engineLimits(engine: TranslateEngine): EngineLimits {
  switch (engine) {
    case 'claude':
    case 'codex':
      // Each prompt starts the CLI again, seconds before the model writes
      // anything, so one chunk carries a whole language of a usual project.
      return { chunkItems: 60, chunkChars: 6000, atOnce: AGENT_PROMPTS_AT_ONCE };
    case 'ai':
      // A key takes several requests at once. A model on this computer or an
      // assistant window answers one at a time, and a small local model loses
      // track of a long list.
      return panelAiKind() === 'api'
        ? { chunkItems: 40, chunkChars: 4000, atOnce: 3 }
        : { chunkItems: 25, chunkChars: 2500, atOnce: 1 };
    case 'libre':
      // The server allows 20 requests and 5000 characters a minute.
      return { chunkItems: 20, chunkChars: 2000, atOnce: 1 };
  }
}

/** A language as each engine wants it named. */
export interface ChunkLanguage {
  /** What a model is told, e.g. "German (Deutsch, de-DE)". */
  model: string;
  /** LibreTranslate's code for it, when the server has the language. */
  machine?: string;
}

/** Whether `engine` can translate into `target` at all. */
export function engineCovers(engine: TranslateEngine, target: ChunkLanguage, source?: ChunkLanguage): boolean {
  if (isOwnEngine(engine)) return true;
  if (!target.machine) return false;
  // en-US to en-GB is the same machine language at both ends, and the server
  // has nothing to say about it. A model does: color becomes colour.
  return !source?.machine || source.machine !== target.machine;
}

export interface ChunkRequest {
  items: Array<{ id: string; text: string }>;
  target: ChunkLanguage;
  /** Unset when the source language is not known. */
  source?: ChunkLanguage;
  /** The user's brief for a model. Our server ignores it. */
  guidance?: string;
  signal?: AbortSignal;
}

export interface ChunkResult {
  /** id -> translation, for the strings that came back. */
  translations: Record<string, string>;
  /** Our server asked to slow down before every string was sent. */
  rateLimited?: boolean;
}

/**
 * One chunk through one engine. Throws when the engine could not be reached or
 * refused, so the run can hand the chunk to the next engine.
 */
export async function translateChunk(engine: TranslateEngine, request: ChunkRequest): Promise<ChunkResult> {
  if (engine === 'libre') {
    if (!request.target.machine) throw new Error('Machine translation does not cover this language');
    const batch = await translateTexts(
      request.items.map((item) => item.text),
      request.target.machine,
      request.source?.machine ?? AUTO_DETECT,
      { signal: request.signal }
    );
    const translations: Record<string, string> = {};
    batch.texts.forEach((text, index) => {
      if (text !== null && text.trim()) translations[request.items[index].id] = text;
    });
    return { translations, rateLimited: batch.rateLimited };
  }
  const translations = await aiTranslateChunk(
    engine === 'ai' ? { kind: 'panel' } : { kind: 'agent', agent: engine },
    {
      items: request.items,
      targetLocale: request.target.model,
      sourceLocale: request.source?.model,
      guidance: request.guidance,
      signal: request.signal,
    }
  );
  return { translations };
}
