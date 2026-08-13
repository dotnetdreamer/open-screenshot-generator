// Every language feature the editor has, as pure functions over the base
// document.
//
// localizedText.ts does this for one string. This is the rest of what the
// language chrome can do: the language list itself, the translation table, the
// per-language overrides that are not text, and the resets that hand a piece of
// a design back to the shared version.
//
// The MCP server is the only caller, so the semantics here are the tool's
// rather than the UI's: a caller with no dialog in front of it gets a miss
// reported back with a reason instead of a guess, and every function takes and
// returns the BASE document, because a projection cannot express "no value" as
// distinct from "the same value the base happens to have".
//
// Nothing here touches React, the DOM, or Dexie.

import { getRecommendedFontForLanguage } from '@/lib/fontLanguageMatcher';
import { hash32 } from '@/lib/i18n/hash';
import { DEFAULT_BASE_LOCALE, LOCALES, getLocaleDef } from '@/lib/i18n/locales';
import {
  getBaseLocale,
  getLocalization,
  getProjectLocales,
  isOverrideEmpty,
  localeCompletion,
  localizableTextElements,
  normalizeLocalization,
  overrideSourceValue,
  overrideStateFor,
  seedBaseLocale,
  setLocalization,
} from '@/lib/i18n/localization';
import { ALWAYS_LOCAL_KEYS, attachProperty, isDetachableKey } from '@/lib/i18n/project';
import { applyLocaleTextWrites, labelFor, type LocaleTextWrite } from '@/lib/i18n/translationCsv';
import type {
  ArtboardElement,
  ArtboardState,
  ElementLocaleOverride,
  LocaleEntry,
  ProjectLocalization,
  TextElementProps,
} from '@/types/artboard';

const ALWAYS_LOCAL = new Set<string>(ALWAYS_LOCAL_KEYS);

/**
 * Which element type each always-local key belongs to. Mirrors the private
 * `acceptsKey` in project.ts: projection silently ignores a key on the wrong
 * type, which for a tool would read as "written" and show nothing.
 */
const ACCEPTED_BY: Record<string, (el: ArtboardElement) => boolean> = {
  content: (el) => el.type === 'text',
  screenshotSrc: (el) => el.type === 'device',
  imageSrc: (el) => el.type === 'image',
  mediaId: (el) => el.type === 'video' || el.type === 'video-device',
};

// ---------------------------------------------------------------------------
// Locating an element
// ---------------------------------------------------------------------------

interface ElementHit {
  board: ArtboardState;
  element: ArtboardElement;
}

/**
 * Find an element by id, with the artboard optional.
 *
 * ensureUniqueElementIds() re-mints ids that repeat across boards on load, so
 * an id normally identifies one element in the whole project and a caller
 * holding a translation table row does not have to carry the board with it.
 * An id that still lands on two boards is reported rather than resolved to
 * whichever came first, since writing German into the wrong screen is the kind
 * of miss nobody notices until the screenshots are on the store.
 */
export function locateElement(
  artboards: ArtboardState[],
  elementId: string,
  artboardId?: string
): ElementHit | { error: string } {
  if (artboardId) {
    const board = artboards.find((candidate) => candidate.id === artboardId);
    if (!board) return { error: `No artboard "${artboardId}".` };
    const element = board.elements.find((el) => el.id === elementId);
    if (!element) return { error: `Artboard "${board.name}" has no element "${elementId}".` };
    return { board, element };
  }
  const hits: ElementHit[] = [];
  for (const board of artboards) {
    const element = board.elements.find((el) => el.id === elementId);
    if (element) hits.push({ board, element });
  }
  if (hits.length === 0) return { error: `No element "${elementId}" in this project.` };
  if (hits.length > 1) {
    return {
      error: `Element "${elementId}" is on ${hits.length} artboards. Pass artboardId to say which one.`,
    };
  }
  return hits[0];
}

// ---------------------------------------------------------------------------
// The catalog
// ---------------------------------------------------------------------------

/** One language the app knows about, and what each downstream system can do with it. */
export interface McpSupportedLocale {
  /** The key every other language tool takes. */
  code: string;
  name: string;
  nativeName: string;
  /**
   * A machine engine can draft this language. False means the strings have to
   * be written (which an MCP client can do itself through set_localized_texts).
   */
  machineTranslation: boolean;
  /** The code App Store Connect files this language under. Absent: no listing. */
  appStoreLocale?: string;
  /** The code Google Play files this language under. Absent: no listing. */
  playLanguage?: string;
  rtl?: boolean;
  script?: string;
  /**
   * The family autoFont substitutes so the script renders at all. Absent means
   * the design's own typeface already covers it, which is every Latin language.
   */
  recommendedFont?: string;
}

/**
 * Resolve a requested language against the CATALOG, which is the vocabulary for
 * adding one: exact code first, then the language part alone when only one code
 * could be meant, then the English or native name. "German", "de" and "de-DE"
 * all land on de-DE; "pt" does not, because Brazil and Portugal are both there
 * and picking one would be a guess about which market is being shipped.
 */
export function resolveCatalogLocale(requested: string): string | null {
  const wanted = requested.trim().toLowerCase();
  if (!wanted) return null;
  const exact = LOCALES.find((def) => def.code.toLowerCase() === wanted);
  if (exact) return exact.code;
  const byLanguage = LOCALES.filter((def) => def.code.toLowerCase().split('-')[0] === wanted);
  if (byLanguage.length === 1) return byLanguage[0].code;
  const byName = LOCALES.find(
    (def) => def.name.toLowerCase() === wanted || def.nativeName.toLowerCase() === wanted
  );
  return byName ? byName.code : null;
}

/** The language catalog, optionally filtered by code, English name or native name. */
export function listSupportedLocales(query?: string): McpSupportedLocale[] {
  const needle = (query ?? '').trim().toLowerCase();
  return LOCALES.filter(
    (def) =>
      !needle ||
      def.code.toLowerCase().includes(needle) ||
      def.name.toLowerCase().includes(needle) ||
      def.nativeName.toLowerCase().includes(needle)
  ).map((def) => ({
    code: def.code,
    name: def.name,
    nativeName: def.nativeName,
    machineTranslation: !!def.translateCode,
    appStoreLocale: def.appleLocale,
    playLanguage: def.playLanguage,
    rtl: def.rtl,
    script: def.script,
    // Same call autoFamilyFor makes, so this is the family the project would
    // really substitute rather than a second opinion about the script.
    recommendedFont: getRecommendedFontForLanguage(def.translateCode || def.code),
  }));
}

// ---------------------------------------------------------------------------
// The project's language list
// ---------------------------------------------------------------------------

/** One export language as the config tools report it back. */
export interface McpLocaleConfigEntry {
  code: string;
  name: string;
  /** Substitute a script-appropriate family where the design's own cannot draw it. */
  autoFont: boolean;
  /** Shrink a translation that overruns its box instead of clipping it. */
  autoFit: boolean;
  translated: number;
  total: number;
}

/** What adding, removing or re-basing the language list did. */
export interface McpLocaleConfigResult {
  baseLocale: string;
  /** Export languages in order. Never contains the base one. */
  locales: McpLocaleConfigEntry[];
  added: string[];
  /** Already there, and had autoFont or autoFit changed. */
  updated: string[];
  removed: string[];
  /** Codes that were asked for and not acted on, with the reason. */
  ignored: Array<{ code: string; reason: string }>;
  /** Translated strings deleted along with the removed languages. */
  droppedStrings: number;
}

/** The language list as the config tools report it, recomputed from the boards. */
export function localeConfigEntries(artboards: ArtboardState[]): McpLocaleConfigEntry[] {
  return configEntries(artboards);
}

function configEntries(artboards: ArtboardState[]): McpLocaleConfigEntry[] {
  return getProjectLocales(artboards).map((entry) => {
    const { translated, total } = localeCompletion(artboards, entry.code);
    return {
      code: entry.code,
      name: getLocaleDef(entry.code)?.name ?? entry.code,
      // Both default to on when absent, which is what a sparse entry means.
      autoFont: entry.autoFont !== false,
      autoFit: entry.autoFit !== false,
      translated,
      total,
    };
  });
}

/** The config as stored, or a fresh one seeded the way the manager dialog seeds it. */
function currentLocalization(artboards: ArtboardState[]): ProjectLocalization {
  const found = getLocalization(artboards);
  if (found) return { baseLocale: found.baseLocale || DEFAULT_BASE_LOCALE, locales: found.locales || [] };
  return { baseLocale: seedBaseLocale(artboards), locales: [] };
}

/**
 * Commit a language config. `undefined` when nothing is left strips the key off
 * every board, which puts a project whose last language was just removed back
 * to being byte-identical to one that never had any, and normalizeLocalization
 * afterwards is what actually deletes a removed language's override maps.
 */
function commitLocalization(
  artboards: ArtboardState[],
  next: ProjectLocalization
): ArtboardState[] {
  const keep = next.locales.length > 0 || next.baseLocale !== DEFAULT_BASE_LOCALE;
  return normalizeLocalization(setLocalization(artboards, keep ? next : undefined));
}

/**
 * Add export languages, and set autoFont / autoFit on any of the listed codes
 * that were already there.
 *
 * `baseLocale` is accepted only while the project has no export languages, the
 * same lock the manager dialog puts on the field: once a language exists, every
 * override is hashed against a base string, and re-basing would silently point
 * all of them at a different source.
 */
export function addProjectLocales(
  artboards: ArtboardState[],
  codes: string[],
  options: { autoFont?: boolean; autoFit?: boolean; baseLocale?: string } = {}
): { artboards: ArtboardState[]; result: McpLocaleConfigResult } {
  const config = currentLocalization(artboards);
  const ignored: Array<{ code: string; reason: string }> = [];

  let baseLocale = config.baseLocale;
  if (options.baseLocale && options.baseLocale !== baseLocale) {
    if (!getLocaleDef(options.baseLocale)) {
      ignored.push({ code: options.baseLocale, reason: 'Not a language this app knows. See list_supported_locales.' });
    } else if (config.locales.length > 0) {
      ignored.push({
        code: options.baseLocale,
        reason:
          'The base language is locked once the project has export languages, because every translation is tracked against the string it was made from. Remove the languages first.',
      });
    } else {
      baseLocale = options.baseLocale;
    }
  }

  const entries = config.locales.filter((entry) => entry.code !== baseLocale).map((entry) => ({ ...entry }));
  const byCode = new Map(entries.map((entry) => [entry.code, entry]));
  const added: string[] = [];
  const updated: string[] = [];

  for (const raw of codes) {
    const code = raw.trim();
    if (!code) continue;
    if (!getLocaleDef(code)) {
      ignored.push({ code, reason: 'Not a language this app knows. See list_supported_locales.' });
      continue;
    }
    if (code === baseLocale) {
      ignored.push({
        code,
        reason: 'That is the base language. The design IS written in it, so it has no overrides of its own.',
      });
      continue;
    }
    const existing = byCode.get(code);
    const target = existing ?? { code };
    let touched = !existing;
    // A sparse entry is the on state for both flags, so an explicit `true`
    // deletes the key rather than storing a default into every project.
    if (options.autoFont !== undefined && (target.autoFont !== false) !== options.autoFont) {
      if (options.autoFont) delete target.autoFont;
      else target.autoFont = false;
      touched = true;
    }
    if (options.autoFit !== undefined && (target.autoFit !== false) !== options.autoFit) {
      if (options.autoFit) delete target.autoFit;
      else target.autoFit = false;
      touched = true;
    }
    if (!existing) {
      entries.push(target);
      byCode.set(code, target);
      added.push(code);
    } else if (touched) {
      updated.push(code);
    }
  }

  const next =
    added.length === 0 && updated.length === 0 && baseLocale === config.baseLocale
      ? artboards
      : commitLocalization(artboards, { baseLocale, locales: entries });

  return {
    artboards: next,
    result: {
      baseLocale,
      locales: configEntries(next),
      added,
      updated,
      removed: [],
      ignored,
      droppedStrings: 0,
    },
  };
}

/** Remove export languages, and every translation stored under them. */
export function removeProjectLocales(
  artboards: ArtboardState[],
  codes: string[]
): { artboards: ArtboardState[]; result: McpLocaleConfigResult } {
  const config = currentLocalization(artboards);
  const wanted = new Set(codes.map((code) => code.trim()).filter(Boolean));
  const ignored: Array<{ code: string; reason: string }> = [];
  const removed: string[] = [];
  let droppedStrings = 0;

  for (const code of wanted) {
    if (!config.locales.some((entry) => entry.code === code)) {
      ignored.push({ code, reason: 'This project does not have that language.' });
      continue;
    }
    removed.push(code);
    // Counted before the sweep, because afterwards there is nothing left to
    // count and "some translations" is not a number anyone can weigh.
    droppedStrings += localeCompletion(artboards, code).translated;
  }

  const next =
    removed.length === 0
      ? artboards
      : commitLocalization(artboards, {
          baseLocale: config.baseLocale,
          locales: config.locales.filter((entry) => !wanted.has(entry.code)),
        });

  return {
    artboards: next,
    result: {
      baseLocale: config.baseLocale,
      locales: configEntries(next),
      added: [],
      updated: [],
      removed,
      ignored,
      droppedStrings,
    },
  };
}

/**
 * Say which language the design itself is written in. Refused once the project
 * has export languages, see addProjectLocales.
 */
export function setProjectBaseLocale(
  artboards: ArtboardState[],
  code: string
): { artboards: ArtboardState[]; result: McpLocaleConfigResult } | { error: string } {
  if (!getLocaleDef(code)) {
    return { error: `"${code}" is not a language this app knows. Call list_supported_locales for the codes.` };
  }
  const config = currentLocalization(artboards);
  if (config.locales.length > 0 && config.baseLocale !== code) {
    return {
      error:
        `This project already exports ${config.locales.length} ${config.locales.length === 1 ? 'language' : 'languages'}, so the base language is locked. ` +
        'Every translation is tracked against the string it was made from, and re-basing would point all of them at a different source. Remove the languages first.',
    };
  }
  const next = commitLocalization(artboards, { baseLocale: code, locales: config.locales });
  return {
    artboards: next,
    result: {
      baseLocale: code,
      locales: configEntries(next),
      added: [],
      updated: [],
      removed: [],
      ignored: [],
      droppedStrings: 0,
    },
  };
}

// ---------------------------------------------------------------------------
// The translation table, as data
// ---------------------------------------------------------------------------

export type McpOverrideState = 'inherited' | 'manual' | 'auto' | 'stale-manual' | 'stale-auto';

export interface McpTranslationCell {
  /** What the language shows, or null when it falls back to the base string. */
  text: string | null;
  /**
   * 'inherited' nothing written. 'manual' a person or an agent wrote it.
   * 'auto' a machine engine did. A 'stale-' prefix means the base string has
   * been edited since, so the translation is of copy that no longer exists.
   */
  state: McpOverrideState;
}

export interface McpTranslationRow {
  artboardId: string;
  artboardName: string;
  elementId: string;
  /** The layer name, or the base string when nobody named the layer. */
  label: string;
  /** The string being translated from. */
  base: string;
  /** Locale to what that language has for this row. */
  translations: Record<string, McpTranslationCell>;
}

export type McpTranslationFilter = 'all' | 'untranslated' | 'translated' | 'stale' | 'machine';

export interface McpTranslationView {
  baseLocale: string;
  /** The languages in the columns, in the order they were asked for. */
  locales: string[];
  filter: McpTranslationFilter;
  /** Rows matching the filter across the whole project. */
  total: number;
  offset: number;
  rows: McpTranslationRow[];
}

export interface TranslationViewOptions {
  /** Unset means every export language. */
  locales?: string[];
  artboardIds?: string[];
  elementIds?: string[];
  filter?: McpTranslationFilter;
  limit?: number;
  offset?: number;
}

function matchesFilter(cells: McpTranslationCell[], filter: McpTranslationFilter): boolean {
  switch (filter) {
    case 'untranslated':
      return cells.some((cell) => cell.state === 'inherited');
    case 'translated':
      return cells.some((cell) => cell.state !== 'inherited');
    case 'stale':
      return cells.some((cell) => cell.state === 'stale-manual' || cell.state === 'stale-auto');
    case 'machine':
      return cells.some((cell) => cell.state === 'auto' || cell.state === 'stale-auto');
    default:
      return true;
  }
}

/**
 * The translation table the dialog draws, as JSON. One row per translatable
 * text element, one cell per language, with where each string came from, which
 * is the thing a caller needs in order to leave reviewed copy alone.
 *
 * Paged, because a 12 board project in 8 languages is a few hundred rows of
 * marketing copy and an MCP response is a chat message.
 */
export function buildTranslationView(
  artboards: ArtboardState[],
  options: TranslationViewOptions = {}
): McpTranslationView {
  const baseLocale = getBaseLocale(artboards);
  const projectCodes = getProjectLocales(artboards).map((entry) => entry.code);
  const locales = (options.locales && options.locales.length > 0 ? options.locales : projectCodes).filter(
    (code) => code !== baseLocale
  );
  const filter = options.filter ?? 'all';
  const boards = options.artboardIds
    ? artboards.filter((board) => options.artboardIds!.includes(board.id))
    : artboards;
  const elementIds = options.elementIds ? new Set(options.elementIds) : null;

  const rows: McpTranslationRow[] = [];
  for (const board of boards) {
    for (const el of localizableTextElements(board)) {
      if (elementIds && !elementIds.has(el.id)) continue;
      const translations: Record<string, McpTranslationCell> = {};
      for (const locale of locales) {
        const override = board.localized?.[locale]?.[el.id];
        const state = overrideStateFor(el, override) as McpOverrideState;
        translations[locale] = {
          text: state === 'inherited' ? null : override?.content ?? null,
          state,
        };
      }
      if (!matchesFilter(Object.values(translations), filter)) continue;
      rows.push({
        artboardId: board.id,
        artboardName: board.name,
        elementId: el.id,
        label: labelFor(el),
        base: el.content,
        translations,
      });
    }
  }

  const offset = Math.max(0, options.offset ?? 0);
  const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
  return {
    baseLocale,
    locales,
    filter,
    total: rows.length,
    offset,
    rows: rows.slice(offset, offset + limit),
  };
}

// ---------------------------------------------------------------------------
// Writing translated copy in bulk
// ---------------------------------------------------------------------------

export interface LocaleTextInput {
  /** Optional: element ids are unique across boards, see locateElement. */
  artboardId?: string;
  elementId: string;
  locale: string;
  /** Empty, or the same as the base copy, clears the override. */
  text: string;
}

export interface McpBulkTextResult {
  /** Strings this call gave a language of its own. */
  written: number;
  /** Strings handed back to the base copy. */
  cleared: number;
  /** Already said exactly that. */
  unchanged: number;
  misses: Array<{ elementId: string; locale: string; reason: string }>;
  /** How complete each language touched by this call now is. */
  completion: Array<{ locale: string; translated: number; total: number }>;
}

/**
 * Write a batch of translated strings in ONE state update.
 *
 * The batch is the point. An MCP client is itself a translator, and the round
 * trip through Rust means a board's worth of strings written one call at a time
 * is a board's worth of undo entries, of Dexie writes, and of chances for two
 * mutations to land in the same tick and clobber each other.
 *
 * Everything written here is marked `manual`, exactly like a string typed into
 * the translation table: a model asked to write store copy is producing the
 * finished thing, and "Update translations" refreshing it from a machine engine
 * later would replace it with something worse.
 */
export function applyLocaleTexts(
  artboards: ArtboardState[],
  inputs: LocaleTextInput[]
): { artboards: ArtboardState[]; result: McpBulkTextResult } {
  const writes: LocaleTextWrite[] = [];
  const misses: McpBulkTextResult['misses'] = [];
  const touched = new Set<string>();
  let written = 0;
  let cleared = 0;
  let unchanged = 0;

  for (const input of inputs) {
    const found = locateElement(artboards, input.elementId, input.artboardId);
    if ('error' in found) {
      misses.push({ elementId: input.elementId, locale: input.locale, reason: found.error });
      continue;
    }
    if (found.element.type !== 'text') {
      misses.push({
        elementId: input.elementId,
        locale: input.locale,
        reason: `That element is a ${found.element.type}, not text. A per-language image or screenshot goes through set_locale_override.`,
      });
      continue;
    }
    const element = found.element as TextElementProps;
    const text = input.text ?? '';
    // Repeating the base string only makes the row look translated when it is
    // not, so it is the same edit as clearing it.
    const value = text.trim().length === 0 || text === element.content ? '' : text;
    const current = found.board.localized?.[input.locale]?.[element.id]?.content ?? '';
    if (current === value) {
      unchanged++;
      continue;
    }
    if (value === '') cleared++;
    else written++;
    touched.add(input.locale);
    writes.push({ artboardId: found.board.id, elementId: element.id, locale: input.locale, value });
  }

  // One pass for the whole batch. applyLocaleTextWrites is the same writer the
  // translation table and the CSV import use, so a string an agent wrote and a
  // string a person typed carry identical bookkeeping.
  const next = applyLocaleTextWrites(artboards, writes);
  return {
    artboards: next,
    result: {
      written,
      cleared,
      unchanged,
      misses,
      completion: [...touched].map((locale) => ({ locale, ...localeCompletion(next, locale) })),
    },
  };
}

// ---------------------------------------------------------------------------
// Per-language overrides that are not copy
// ---------------------------------------------------------------------------

export interface LocaleOverrideInput {
  artboardId?: string;
  elementId: string;
  locale: string;
  /** Property to value. null hands that property back to the shared design. */
  props: Record<string, unknown>;
}

export interface McpLocaleOverrideResult {
  artboardId: string;
  elementId: string;
  locale: string;
  /** The properties this element keeps its own copy of in this language. */
  detached: string[];
  /** The stored row, or null once the element is fully back on the base design. */
  override: ElementLocaleOverride | null;
  applied: string[];
  /** Properties that were asked for and not written, with the reason. */
  ignored: Array<{ key: string; reason: string }>;
}

/**
 * Give one element its own copy of one or more properties in one language.
 *
 * Two kinds of key go in here and they behave differently, which is the whole
 * subtlety of the overlay:
 *
 * - `content`, `screenshotSrc`, `imageSrc` and `mediaId` are ALWAYS per
 *   language. Writing one just writes it.
 * - everything else a drawing property (`position`, `size`, `fontSize`,
 *   `color`, `fontFamily`, ...) is SHARED until it is detached. Writing one
 *   here detaches it in the same edit, because a value stored without the flag
 *   is dead data that projection ignores. That is how an Arabic layout moves
 *   its badge to the other edge while every other language keeps the design.
 *
 * `hidden: true` drops the element from this language only, which is how a
 * badge that says "App of the Day" stays out of the markets that never ran it.
 */
export function applyLocaleOverride(
  artboards: ArtboardState[],
  input: LocaleOverrideInput
): { artboards: ArtboardState[]; result: McpLocaleOverrideResult } | { error: string } {
  const found = locateElement(artboards, input.elementId, input.artboardId);
  if ('error' in found) return found;
  const { board, element } = found;

  const current = board.localized?.[input.locale]?.[element.id];
  let next: ElementLocaleOverride = { ...(current ?? {}) };
  const applied: string[] = [];
  const ignored: McpLocaleOverrideResult['ignored'] = [];

  for (const [key, raw] of Object.entries(input.props)) {
    if (raw === undefined) continue;
    const clearing = raw === null;

    if (ALWAYS_LOCAL.has(key)) {
      if (!ACCEPTED_BY[key](element)) {
        ignored.push({ key, reason: `A ${element.type} element has no ${key}.` });
        continue;
      }
      if (clearing || raw === '') delete (next as Record<string, unknown>)[key];
      else (next as Record<string, unknown>)[key] = raw;
      applied.push(key);
      continue;
    }

    if (key === 'hidden') {
      // Stored only when true. `hidden: false` and no entry at all are the same
      // statement, and keeping the false would make the row read as overridden.
      if (clearing || raw === false) delete next.hidden;
      else next.hidden = true;
      applied.push(key);
      continue;
    }

    if (!isDetachableKey(key)) {
      ignored.push({
        key,
        reason:
          'This property identifies the layer or drives the timeline, so it cannot differ between languages. Change it with update_element, which reaches every language at once.',
      });
      continue;
    }

    if (clearing) {
      next = attachProperty(next, key) ?? {};
    } else {
      next.detached = Array.from(new Set([...(next.detached ?? []), key]));
      (next as Record<string, unknown>)[key] = raw;
    }
    applied.push(key);
  }

  const empty = isOverrideEmpty(next);
  if (!empty) {
    next.origin = 'manual';
    // Hashed through the same helper unprojectArtboards uses, so the staleness
    // check can never disagree with the writer about what it tracked.
    const source = overrideSourceValue(element, next);
    if (source === undefined) delete next.sourceHash;
    else next.sourceHash = hash32(source);
  }

  const stored = empty ? undefined : next;
  return {
    // By reference when the row is already exactly this, so a call that only
    // repeated what was there does not push an undo entry over it.
    artboards: sameOverride(current, stored)
      ? artboards
      : writeOverride(artboards, board.id, element.id, input.locale, stored),
    result: {
      artboardId: board.id,
      elementId: element.id,
      locale: input.locale,
      detached: next.detached ?? [],
      override: empty ? null : next,
      applied,
      ignored,
    },
  };
}

/**
 * Whether two override rows say the same thing. Values here are strings,
 * numbers and small plain objects (position, size), and the new row is built by
 * spreading the old one so key order survives, which is what makes the cheap
 * comparison sound.
 */
function sameOverride(
  a: ElementLocaleOverride | undefined,
  b: ElementLocaleOverride | undefined
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Put one override row back, dropping the maps it empties on the way out. */
function writeOverride(
  artboards: ArtboardState[],
  artboardId: string,
  elementId: string,
  locale: string,
  override: ElementLocaleOverride | undefined
): ArtboardState[] {
  return artboards.map((board) => {
    if (board.id !== artboardId) return board;
    const forLocale = { ...(board.localized?.[locale] ?? {}) };
    if (override) forLocale[elementId] = override;
    else delete forLocale[elementId];

    const localized = { ...(board.localized ?? {}) };
    // An emptied map is dropped rather than kept as {}, so
    // `board.localized?.[locale]` keeps reading as "nothing here".
    if (Object.keys(forLocale).length > 0) localized[locale] = forLocale;
    else delete localized[locale];

    const next: ArtboardState = { ...board };
    if (Object.keys(localized).length > 0) next.localized = localized;
    else delete next.localized;
    return next;
  });
}

// ---------------------------------------------------------------------------
// Handing a language back to the shared design
// ---------------------------------------------------------------------------

export interface LocaleResetInput {
  locale: string;
  scope: 'element' | 'artboard' | 'project';
  artboardId?: string;
  elementId?: string;
  /** Only these properties. Unset drops the whole override row. */
  fields?: string[];
}

export interface McpLocaleResetResult {
  locale: string;
  scope: string;
  /** Elements that had something taken back. */
  elements: number;
  /** Individual properties dropped, when `fields` narrowed the reset. */
  fields: number;
  /** Rows removed entirely. */
  cleared: number;
}

/**
 * "Reset to base", at whichever scope was asked for. Dropping the override row
 * IS the reset: with nothing of its own left, the element is projected verbatim
 * from the base design again.
 *
 * With `fields`, only those properties go, which is the per-control reset the
 * Properties panel offers next to each detached field.
 */
export function resetLocaleOverrides(
  artboards: ArtboardState[],
  input: LocaleResetInput
): { artboards: ArtboardState[]; result: McpLocaleResetResult } | { error: string } {
  if (input.scope === 'element' && !input.elementId) {
    return { error: 'Resetting one element needs elementId.' };
  }
  let artboardId = input.artboardId;
  if (input.scope === 'element' && !artboardId) {
    const found = locateElement(artboards, input.elementId!, undefined);
    if ('error' in found) return found;
    artboardId = found.board.id;
  }
  if (input.scope === 'artboard' && !artboardId) {
    return { error: 'Resetting one artboard needs artboardId.' };
  }

  const fields = input.fields && input.fields.length > 0 ? input.fields : null;
  let elements = 0;
  let droppedFields = 0;
  let cleared = 0;

  const next = artboards.map((board) => {
    if (input.scope !== 'project' && board.id !== artboardId) return board;
    const forLocale = board.localized?.[input.locale];
    if (!forLocale) return board;

    const nextForLocale: Record<string, ElementLocaleOverride> = {};
    let boardChanged = false;
    for (const [elementId, override] of Object.entries(forLocale)) {
      if (input.scope === 'element' && elementId !== input.elementId) {
        nextForLocale[elementId] = override;
        continue;
      }
      if (!fields) {
        elements++;
        cleared++;
        boardChanged = true;
        continue;
      }
      let edited: ElementLocaleOverride = { ...override };
      let touched = false;
      for (const key of fields) {
        if (ALWAYS_LOCAL.has(key) || key === 'hidden' || key === 'fontFamily') {
          if ((edited as Record<string, unknown>)[key] === undefined) continue;
          delete (edited as Record<string, unknown>)[key];
          // fontFamily is detachable as well, so the flag has to go with it or
          // projection keeps looking for a value that is no longer there.
          if (edited.detached?.includes(key)) {
            edited = attachProperty(edited, key) ?? {};
          }
          touched = true;
          droppedFields++;
          continue;
        }
        if (!edited.detached?.includes(key)) continue;
        edited = attachProperty(edited, key) ?? {};
        touched = true;
        droppedFields++;
      }
      if (!touched) {
        nextForLocale[elementId] = override;
        continue;
      }
      elements++;
      boardChanged = true;
      if (isOverrideEmpty(edited)) {
        cleared++;
        continue;
      }
      nextForLocale[elementId] = edited;
    }

    if (!boardChanged) return board;
    const localized = { ...board.localized };
    if (Object.keys(nextForLocale).length > 0) localized[input.locale] = nextForLocale;
    else delete localized[input.locale];
    const nextBoard: ArtboardState = { ...board };
    if (Object.keys(localized).length > 0) nextBoard.localized = localized;
    else delete nextBoard.localized;
    return nextBoard;
  });

  return {
    artboards: elements === 0 ? artboards : next,
    result: {
      locale: input.locale,
      scope: input.scope,
      elements,
      fields: droppedFields,
      cleared,
    },
  };
}

// ---------------------------------------------------------------------------
// Shared with the layout
// ---------------------------------------------------------------------------

/** The entry a locale's projection reads, for callers that need its flags. */
export function localeEntryFor(artboards: ArtboardState[], code: string): LocaleEntry | undefined {
  return getProjectLocales(artboards).find((entry) => entry.code === code);
}
