// Machine translation into one language, written as overrides.
//
// The rule this file exists to enforce: base content is never touched. A run
// writes into `localized[locale]` and marks everything it writes `origin:
// 'auto'` with a fresh sourceHash, so "Update translations" can refresh its own
// output later and can tell it apart from a string a person typed.
//
// The other rule is honest counting. The handler this replaces incremented
// nothing when a 429 arrived, so "translated 7 elements" could mean "and
// abandoned 23 without saying so". Every element that was asked for is
// accounted for here as translated, failed, or skipped, and a rate limit is
// reported as itself because waiting a minute is a different instruction from
// trying something else.

import type {
  ArtboardState,
  ElementLocaleOverride,
  TextElementProps,
} from '@/types/artboard';
import {
  AUTO_DETECT,
  isTranslationEnabled,
  translateTexts,
} from '@/services/translation';
import { aiTranslateStrings, isAiTranslateAvailable } from '@/lib/ai/translateStrings';
import {
  getBaseLocale,
  getProjectLocales,
  isStaleOverride,
  localizableTextElements,
  overrideSourceValue,
} from './localization';
import { getLocaleDef, localeName } from './locales';
import { hash32 } from './hash';

export type TranslateEngine = 'ai' | 'libre';

export interface TranslateIntoLocaleOptions {
  engine: TranslateEngine;
  /** Which strings the run is allowed to touch. */
  only: 'empty' | 'stale' | 'all';
  /** Refresh strings a person typed. Off by default, and it has to stay off by default. */
  includeManual?: boolean;
  /** Brand brief passed to the AI engine. Machine translation ignores it. */
  guidance?: string;
  onProgress?: (done: number, total: number) => void;
  /** Limit the run to these artboards. Unset means every artboard. */
  artboardIds?: string[];
  /** Limit the run to these elements. Unset means every text element. */
  elementIds?: string[];
  signal?: AbortSignal;
}

export interface TranslateIntoLocaleResult {
  artboards: ArtboardState[];
  translated: number;
  /** Asked for and did not come back. */
  failed: number;
  /** In scope but deliberately left alone: a human wrote it. */
  skipped: number;
  /** The server stopped answering, so `failed` includes strings never sent. */
  rateLimited: boolean;
}

/** Engines that would actually work right now, best first. */
export function availableEngines(): TranslateEngine[] {
  const engines: TranslateEngine[] = [];
  if (isAiTranslateAvailable()) engines.push('ai');
  if (isTranslationEnabled) engines.push('libre');
  return engines;
}

interface Target {
  boardIndex: number;
  elementId: string;
  element: TextElementProps;
}

/** One distinct string, and every element waiting on it. */
interface Group {
  text: string;
  targets: Target[];
}

function empty(artboards: ArtboardState[]): TranslateIntoLocaleResult {
  return { artboards, translated: 0, failed: 0, skipped: 0, rateLimited: false };
}

/** How the model is told which language it is working in. */
function localeForModel(code: string): string {
  const def = getLocaleDef(code);
  return def ? `${def.name} (${def.nativeName}, ${def.code})` : code;
}

/** True for a provider error that means "wait", not "this will never work". */
function looksRateLimited(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as { status?: unknown; statusCode?: unknown; message?: unknown };
  if (record.status === 429 || record.statusCode === 429) return true;
  return typeof record.message === 'string' && /rate limit/i.test(record.message);
}

/**
 * Translate one language's strings and give back the base document with the new
 * overrides folded in. The input array is returned by reference when nothing
 * was written, so a run that found nothing to do does not push a history entry.
 *
 * Throws only for a setup problem the user has to fix: a language with no
 * machine translation path, or an engine that is not configured. Everything a
 * run can survive comes back in the counts.
 */
export async function translateIntoLocale(
  artboards: ArtboardState[],
  locale: string,
  options: TranslateIntoLocaleOptions
): Promise<TranslateIntoLocaleResult> {
  const entry = getProjectLocales(artboards).find((candidate) => candidate.code === locale);
  if (!entry) return empty(artboards);

  const baseLocale = getBaseLocale(artboards);
  const targets: Target[] = [];
  let skipped = 0;

  artboards.forEach((board, boardIndex) => {
    // The artboard toolbar and the Properties panel translate one board or one
    // element, not the project, so they narrow the run rather than owning a
    // second translation path that could write the base by mistake.
    if (options.artboardIds && !options.artboardIds.includes(board.id)) return;
    const map = board.localized?.[locale];
    for (const element of localizableTextElements(board)) {
      if (options.elementIds && !options.elementIds.includes(element.id)) continue;
      const override = map?.[element.id];
      const written = !!override?.content?.trim();

      const inScope =
        options.only === 'all'
          ? true
          : options.only === 'empty'
            ? !written
            : written && !!override && isStaleOverride(element, override);
      if (!inScope) continue;

      // An override with no origin was typed, imported, or written by a build
      // that did not record one. "We do not know who wrote this" has to read as
      // "a person did", or one careless run overwrites reviewed copy.
      if (written && !options.includeManual && override?.origin !== 'auto') {
        skipped++;
        continue;
      }
      targets.push({ boardIndex, elementId: element.id, element });
    }
  });

  if (targets.length === 0) {
    return { artboards, translated: 0, failed: 0, skipped, rateLimited: false };
  }

  // Report the total before any engine work, so the readout says "0 of 12" from
  // the first frame rather than "0 strings" until the first callback lands.
  options.onProgress?.(0, targets.length);

  // Screenshot sets repeat strings across boards ("Get started", a tagline in a
  // footer), and every repeat is another request against a per minute budget.
  const groups: Group[] = [];
  const byText = new Map<string, Group>();
  for (const target of targets) {
    const text = target.element.content;
    let group = byText.get(text);
    if (!group) {
      group = { text, targets: [] };
      byText.set(text, group);
      groups.push(group);
    }
    group.targets.push(target);
  }

  // Progress is reported in elements, which is what the counts and the UI talk
  // in, even though the engines work in distinct strings.
  const reportProgress = (done: number, total: number) => {
    if (!options.onProgress || total === 0) return;
    options.onProgress(Math.min(targets.length, Math.round((done / total) * targets.length)), targets.length);
  };

  let results: Array<string | null>;
  let rateLimited = false;

  if (options.engine === 'ai') {
    const items = groups.map((group, index) => ({ id: `s${index + 1}`, text: group.text }));
    let map: Record<string, string> = {};
    try {
      map = await aiTranslateStrings({
        items,
        targetLocale: localeForModel(locale),
        sourceLocale: localeForModel(baseLocale),
        guidance: options.guidance,
        signal: options.signal,
        onProgress: reportProgress,
      });
    } catch (error) {
      // A rate limit is a wait, not a misconfiguration, so it is reported in
      // the counts like the machine engine's is rather than thrown at the user.
      if (!looksRateLimited(error)) throw error;
      rateLimited = true;
    }
    results = items.map((item) => map[item.id] ?? null);
  } else {
    if (!isTranslationEnabled) {
      throw new Error('Machine translation is not configured in this build.');
    }
    const targetDef = getLocaleDef(locale);
    if (!targetDef?.translateCode) {
      throw new Error(
        `Machine translation does not cover ${localeName(locale)}. Type those strings in, or import them from a CSV.`
      );
    }
    const source = getLocaleDef(baseLocale)?.translateCode || AUTO_DETECT;
    // en-US to en-GB is the same machine language on both ends, so there is
    // nothing a translator could do with it and nothing worth a request.
    if (source !== AUTO_DETECT && source === targetDef.translateCode) {
      return { artboards, translated: 0, failed: 0, skipped: skipped + targets.length, rateLimited: false };
    }

    const batch = await translateTexts(
      groups.map((group) => group.text),
      targetDef.translateCode,
      source,
      { signal: options.signal, onProgress: reportProgress }
    );
    results = batch.texts;
    rateLimited = batch.rateLimited;
  }

  // --- write the overrides ---------------------------------------------------

  const perBoard = new Map<number, Record<string, ElementLocaleOverride>>();
  let translated = 0;

  groups.forEach((group, index) => {
    const value = results[index];
    if (value === null || value === undefined || !value.trim()) return;
    for (const target of group.targets) {
      const board = artboards[target.boardIndex];
      let map = perBoard.get(target.boardIndex);
      if (!map) {
        map = { ...(board.localized?.[locale] || {}) };
        perBoard.set(target.boardIndex, map);
      }
      const next: ElementLocaleOverride = {
        ...(map[target.elementId] || {}),
        content: value,
        origin: 'auto',
      };
      // Hashed through the same helper the staleness check reads, so the two can
      // never disagree about which base string this came from.
      const sourceValue = overrideSourceValue(target.element, next);
      if (sourceValue === undefined) delete next.sourceHash;
      else next.sourceHash = hash32(sourceValue);
      map[target.elementId] = next;
      translated++;
    }
  });

  const result: TranslateIntoLocaleResult = {
    artboards,
    translated,
    failed: targets.length - translated,
    skipped,
    rateLimited,
  };
  if (perBoard.size === 0) return result;

  result.artboards = artboards.map((board, index) => {
    const map = perBoard.get(index);
    if (!map) return board;
    return { ...board, localized: { ...(board.localized || {}), [locale]: map } };
  });
  return result;
}
