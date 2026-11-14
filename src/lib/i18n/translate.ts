// Machine translation into a project's languages, written as overrides.
//
// The rule this file exists to enforce: base content is never touched. A run
// writes into `localized[locale]` and marks everything it writes `origin:
// 'auto'` with a fresh sourceHash, so "Update translations" can refresh its own
// output later and can tell it apart from a string a person typed.
//
// The other rule is honest counting. Every element that was asked for is
// accounted for here as translated, failed, or skipped, and a rate limit is
// reported as itself because waiting a minute is a different instruction from
// trying something else.
//
// Who translates is engines.ts, and translateRun.ts runs the languages side by
// side. Each language only ever writes its own `localized[locale]`, which is
// what lets them run at once and still fold into one document.

import type {
  ArtboardState,
  ElementLocaleOverride,
  TextElementProps,
} from '@/types/artboard';
import {
  getBaseLocale,
  getProjectLocales,
  isStaleOverride,
  localizableTextElements,
  overrideSourceValue,
} from './localization';
import { getLocaleDef, localeName } from './locales';
import { hash32 } from './hash';
import { isOwnEngine, resolveEngines, type ChunkLanguage, type TranslateEngine } from './engines';
import { runTranslation, type TranslationJob } from './translateRun';

export { availableEngines, type TranslateEngine } from './engines';

export interface TranslateLocalesOptions {
  /** The engines to try, best first. Unset means every engine set up now (resolveEngines). */
  engines?: TranslateEngine[];
  /** Which strings the run is allowed to touch. */
  only: 'empty' | 'stale' | 'all';
  /** Refresh strings a person typed. Off by default, and it has to stay off by default. */
  includeManual?: boolean;
  /** Brand brief passed to a model. Our server ignores it. */
  guidance?: string;
  onProgress?: (progress: TranslateLocalesProgress) => void;
  /** Limit the run to these artboards. Unset means every artboard. */
  artboardIds?: string[];
  /** Limit the run to these elements. Unset means every text element. */
  elementIds?: string[];
  signal?: AbortSignal;
}

export interface TranslateLocalesProgress {
  /** Elements written so far, and all the run will try, every language together. */
  done: number;
  total: number;
  /** Languages with nothing left to write, of how many. */
  localesDone: number;
  localeCount: number;
  /** The engine at work. Null when there is none. */
  engine: TranslateEngine | null;
}

export interface LocaleTranslation {
  locale: string;
  translated: number;
  /** Asked for and did not come back. */
  failed: number;
  /** In scope but deliberately left alone: a human wrote it, or there is nothing to translate. */
  skipped: number;
  /** Our server stopped answering, so `failed` includes strings never sent. */
  rateLimited: boolean;
  /** The engine that wrote most of this language. */
  engine?: TranslateEngine;
  /** Why strings did not come back, when an engine said so. */
  error?: string;
}

export interface TranslateLocalesResult {
  artboards: ArtboardState[];
  /** One entry per requested language that the project has, in order. */
  locales: LocaleTranslation[];
  /** The engine that wrote most, else the first one tried. Null when none is set up. */
  engine: TranslateEngine | null;
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

interface LocalePlan {
  locale: string;
  targets: Target[];
  groups: Group[];
  skipped: number;
}

/** How the model is told which language it is working in. */
function localeForModel(code: string): string {
  const def = getLocaleDef(code);
  return def ? `${def.name} (${def.nativeName}, ${def.code})` : code;
}

function chunkLanguage(code: string): ChunkLanguage {
  return { model: localeForModel(code), machine: getLocaleDef(code)?.translateCode };
}

/** The elements one language should get, by distinct string. */
function planLocale(artboards: ArtboardState[], locale: string, options: TranslateLocalesOptions): LocalePlan {
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

  // Screenshot sets repeat strings across boards ("Get started", a tagline in a
  // footer), and every repeat is another request.
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
  return { locale, targets, groups, skipped };
}

/**
 * Translate several languages at once and give back the base document with
 * the new overrides folded in. The input array is returned by reference when
 * nothing was written, so a run that found nothing to do does not push a
 * history entry.
 *
 * Never throws. A language that could not be translated at all says why in
 * its `error`.
 */
export async function translateIntoLocales(
  artboards: ArtboardState[],
  locales: string[],
  options: TranslateLocalesOptions
): Promise<TranslateLocalesResult> {
  const inProject = new Set(getProjectLocales(artboards).map((entry) => entry.code));
  const requested = locales.filter((locale, index) => inProject.has(locale) && locales.indexOf(locale) === index);
  const engines = options.engines ?? (await resolveEngines());
  const baseLocale = getBaseLocale(artboards);
  const source = chunkLanguage(baseLocale);

  const results = new Map<string, LocaleTranslation>();
  const plans: LocalePlan[] = [];
  const jobs: TranslationJob[] = [];

  for (const locale of requested) {
    const plan = planLocale(artboards, locale, options);
    const result: LocaleTranslation = {
      locale,
      translated: 0,
      failed: 0,
      skipped: plan.skipped,
      rateLimited: false,
    };
    results.set(locale, result);
    if (plan.targets.length === 0) continue;

    if (engines.length === 0) {
      result.failed = plan.targets.length;
      result.error = 'Nothing is set up to translate with. Add an AI in the AI panel, or type the strings into the translations table';
      continue;
    }
    const target = chunkLanguage(locale);
    // With only our server to ask, a language it lacks is a setup problem the
    // user has to hear about, and en-US to en-GB is nothing to do. A model
    // ahead of it in the list covers both.
    if (!engines.some(isOwnEngine)) {
      if (!target.machine) {
        result.error = `Machine translation does not cover ${localeName(locale)}. Type those strings in, or import them from a CSV.`;
        continue;
      }
      if (source.machine && source.machine === target.machine) {
        result.skipped += plan.targets.length;
        continue;
      }
    }
    plans.push(plan);
    jobs.push({
      key: locale,
      items: plan.groups.map((group, index) => ({ id: `s${index + 1}`, text: group.text, weight: group.targets.length })),
      target,
      source,
    });
  }

  const settled = requested.length - jobs.length;
  const total = plans.reduce((sum, plan) => sum + plan.targets.length, 0);
  // Report the total before any engine work, so the readout says "0 of 12" from
  // the first frame rather than "0 strings" until the first callback lands.
  options.onProgress?.({ done: 0, total, localesDone: settled, localeCount: requested.length, engine: engines[0] ?? null });

  const outcomes =
    jobs.length > 0
      ? await runTranslation(jobs, {
          engines,
          guidance: options.guidance,
          signal: options.signal,
          onProgress: (progress) =>
            options.onProgress?.({
              done: progress.done,
              total,
              localesDone: settled + progress.jobsDone,
              localeCount: requested.length,
              engine: progress.engine,
            }),
        })
      : [];

  // --- write the overrides ---------------------------------------------------

  const perBoard = new Map<number, Map<string, Record<string, ElementLocaleOverride>>>();
  const tally = new Map<TranslateEngine, number>();

  plans.forEach((plan, planIndex) => {
    const outcome = outcomes[planIndex];
    const result = results.get(plan.locale)!;
    plan.groups.forEach((group, index) => {
      const value = outcome.translations.get(`s${index + 1}`);
      if (value === undefined || !value.trim()) return;
      for (const target of group.targets) {
        const board = artboards[target.boardIndex];
        let locales = perBoard.get(target.boardIndex);
        if (!locales) {
          locales = new Map();
          perBoard.set(target.boardIndex, locales);
        }
        let map = locales.get(plan.locale);
        if (!map) {
          map = { ...(board.localized?.[plan.locale] || {}) };
          locales.set(plan.locale, map);
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
        result.translated++;
      }
    });
    result.failed = plan.targets.length - result.translated;
    result.rateLimited = outcome.rateLimited;
    result.engine = outcome.engine;
    if (result.failed > 0) {
      result.error =
        outcome.error ??
        (outcome.uncovered
          ? `Machine translation does not cover ${localeName(plan.locale)}. Type those strings in, or import them from a CSV.`
          : undefined);
    }
    if (outcome.engine) tally.set(outcome.engine, (tally.get(outcome.engine) ?? 0) + result.translated);
  });

  let engine: TranslateEngine | null = engines[0] ?? null;
  let most = 0;
  for (const [candidate, count] of tally) {
    if (count > most) {
      engine = candidate;
      most = count;
    }
  }

  const final: TranslateLocalesResult = {
    artboards,
    locales: requested.map((locale) => results.get(locale)!),
    engine,
  };
  if (perBoard.size === 0) return final;

  final.artboards = artboards.map((board, index) => {
    const locales = perBoard.get(index);
    if (!locales) return board;
    const localized = { ...(board.localized || {}) };
    for (const [locale, map] of locales) localized[locale] = map;
    return { ...board, localized };
  });
  return final;
}

// --- one language ---------------------------------------------------------------

export type TranslateIntoLocaleOptions = TranslateLocalesOptions;

export interface TranslateIntoLocaleResult {
  artboards: ArtboardState[];
  translated: number;
  /** Asked for and did not come back. */
  failed: number;
  /** In scope but deliberately left alone: a human wrote it. */
  skipped: number;
  /** Our server stopped answering, so `failed` includes strings never sent. */
  rateLimited: boolean;
  /** The engine that wrote most of it. */
  engine?: TranslateEngine;
  /** Why some strings did not come back, when an engine said so. */
  error?: string;
}

/**
 * Translate one language. Throws when nothing could be written and there is
 * a reason to give: a language no engine covers, or every engine failing.
 * Everything a run can survive comes back in the counts.
 */
export async function translateIntoLocale(
  artboards: ArtboardState[],
  locale: string,
  options: TranslateIntoLocaleOptions
): Promise<TranslateIntoLocaleResult> {
  const result = await translateIntoLocales(artboards, [locale], options);
  const entry = result.locales[0];
  if (!entry) return { artboards, translated: 0, failed: 0, skipped: 0, rateLimited: false };
  if (entry.error && entry.translated === 0 && !entry.rateLimited && !options.signal?.aborted) {
    throw new Error(entry.error);
  }
  return {
    artboards: result.artboards,
    translated: entry.translated,
    failed: entry.failed,
    skipped: entry.skipped,
    rateLimited: entry.rateLimited,
    engine: entry.engine,
    error: entry.error,
  };
}

// --- strings with no language attached --------------------------------------------

export interface TranslateTextsResult {
  /** One entry per input, in order. null where the string did not come back. */
  texts: Array<string | null>;
  /** The engine that wrote most of them. */
  engine?: TranslateEngine;
  /** Why some did not come back, when an engine said so. */
  error?: string;
}

/**
 * Translate loose strings, for the Translate dialog's run on a project with no
 * languages, which writes over the text itself. `engines` are the user's own
 * AIs: that dialog asks our server through a path of its own.
 */
export async function translateTextsWith(
  texts: string[],
  target: ChunkLanguage,
  source: ChunkLanguage | undefined,
  options: {
    engines: TranslateEngine[];
    signal?: AbortSignal;
    onProgress?: (done: number, total: number, engine: TranslateEngine) => void;
  }
): Promise<TranslateTextsResult> {
  const distinct: string[] = [];
  const weights = new Map<string, number>();
  for (const text of texts) {
    if (!text || !text.trim()) continue;
    if (!weights.has(text)) distinct.push(text);
    weights.set(text, (weights.get(text) ?? 0) + 1);
  }
  if (distinct.length === 0) return { texts: texts.map((text) => (text && text.trim() ? null : text)) };

  const [outcome] = await runTranslation(
    [
      {
        key: target.model,
        items: distinct.map((text, index) => ({ id: `s${index + 1}`, text, weight: weights.get(text) })),
        target,
        source,
      },
    ],
    {
      engines: options.engines,
      signal: options.signal,
      onProgress: (progress) => options.onProgress?.(progress.done, progress.total, progress.engine),
    }
  );
  const byText = new Map<string, string>();
  distinct.forEach((text, index) => {
    const value = outcome.translations.get(`s${index + 1}`);
    if (value !== undefined && value.trim()) byText.set(text, value);
  });
  return {
    texts: texts.map((text) => (!text || !text.trim() ? text : byText.get(text) ?? null)),
    engine: outcome.engine,
    error: outcome.error,
  };
}

// --- the Translate dialog, writing over the text itself ---------------------------

/** One text element an in-place run sends, named by its artboard and its id. */
export interface InPlaceText {
  artboardId: string;
  elementId: string;
  content: string;
}

/**
 * The text elements of `artboardIds` that have something to translate, in
 * artboard order. Each carries its artboard as well as its id: opening a
 * project makes ids unique across it (ensureUniqueElementIds), and keying by
 * both keeps every write on its own artboard should two ever coincide.
 */
export function inPlaceTexts(artboards: ArtboardState[], artboardIds: Set<string>): InPlaceText[] {
  return artboards
    .filter((board) => artboardIds.has(board.id))
    .flatMap((board) =>
      board.elements
        .filter((el): el is TextElementProps => el.type === 'text' && !!el.content?.trim())
        .map((el) => ({ artboardId: board.id, elementId: el.id, content: el.content }))
    );
}

/**
 * Write `translations` (one per entry of `texts`, null where none came back)
 * over the text of `artboards`, the project as it is now. A text edited since
 * `texts` was taken keeps the edit. An artboard says it is in `language` only
 * when all of its text made it across.
 */
export function writeInPlace(
  artboards: ArtboardState[],
  texts: InPlaceText[],
  translations: Array<string | null>,
  options: { artboardIds: Set<string>; language: string; fontFamily?: string }
): { artboards: ArtboardState[]; written: number } {
  const keyOf = (artboardId: string, elementId: string) => `${artboardId}\u0000${elementId}`;
  const sent = new Map<string, { content: string; value: string | null }>();
  texts.forEach((text, index) => {
    sent.set(keyOf(text.artboardId, text.elementId), { content: text.content, value: translations[index] ?? null });
  });
  let written = 0;
  const next = artboards.map((board) => {
    if (!options.artboardIds.has(board.id)) return board;
    let whole = true;
    const elements = board.elements.map((el) => {
      if (el.type !== 'text' || !el.content?.trim()) return el;
      const entry = sent.get(keyOf(board.id, el.id));
      if (!entry?.value || el.content !== entry.content) {
        whole = false;
        return el;
      }
      written++;
      return { ...el, content: entry.value, ...(options.fontFamily ? { fontFamily: options.fontFamily } : {}) };
    });
    return { ...board, elements, language: whole ? options.language : undefined };
  });
  return { artboards: written > 0 ? next : artboards, written };
}
