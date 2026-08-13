// Reading and repairing the locale overlay's bookkeeping.
//
// The overlay itself is two pure functions in project.ts. This file owns
// everything around them: where the project's language list lives, what counts
// as translated, and the sweeps that keep a project's override maps honest
// after an import, a duplicate, or a delete that forgot to clean up.
//
// Nothing here touches the DOM or React, because the same functions run inside
// renderers, inside the export loop, and inside the MCP server.

import type {
  ArtboardElement,
  ArtboardState,
  ElementLocaleOverride,
  LocaleEntry,
  ProjectLocalization,
  TextElementProps,
} from '@/types/artboard';
import { DEFAULT_BASE_LOCALE, LOCALES } from './locales';
import { hash32 } from './hash';

/**
 * The project's language config. Mirrored onto every board, so the first board
 * carrying one is the answer: normalizeLocalization() re-stamps the rest on
 * load, which is what keeps a board that arrived from an import in step.
 */
export function getLocalization(artboards: ArtboardState[]): ProjectLocalization | undefined {
  for (const board of artboards) {
    if (board.localization) return board.localization;
  }
  return undefined;
}

/**
 * Stamps `next` onto every board, or strips it everywhere when `next` is
 * undefined. Returns the input by reference when every board already agrees,
 * so calling it on an unchanged project does not invalidate a memo.
 */
export function setLocalization(
  artboards: ArtboardState[],
  next: ProjectLocalization | undefined
): ArtboardState[] {
  if (artboards.every((board) => board.localization === next)) return artboards;
  return artboards.map((board) => {
    if (board.localization === next) return board;
    if (!next) {
      const { localization, ...rest } = board;
      return rest as ArtboardState;
    }
    return { ...board, localization: next };
  });
}

/**
 * Repairs the overlay's invariants. Idempotent, and returns the input BY
 * REFERENCE when there is nothing to repair, which is every project that exists
 * today: a project with no localization is left completely alone, overrides and
 * all, because dropping data we cannot currently reach would turn a lost config
 * into a lost translation.
 *
 * When there is a localization it: re-stamps it onto every board, drops the
 * base locale's own override map (the base IS the base, an override on it can
 * only shadow itself), drops maps for locales no longer in the list, and drops
 * entries whose element id is gone from that board.
 */
export function normalizeLocalization(artboards: ArtboardState[]): ArtboardState[] {
  const found = getLocalization(artboards);
  if (!found) return artboards;

  const baseLocale = found.baseLocale || DEFAULT_BASE_LOCALE;
  const seen = new Set<string>();
  const locales: LocaleEntry[] = [];
  for (const entry of found.locales || []) {
    if (!entry?.code || entry.code === baseLocale || seen.has(entry.code)) continue;
    seen.add(entry.code);
    locales.push(entry);
  }

  const sameConfig =
    found.baseLocale === baseLocale &&
    Array.isArray(found.locales) &&
    found.locales.length === locales.length &&
    found.locales.every((entry, i) => entry === locales[i]);
  const localization: ProjectLocalization = sameConfig ? found : { baseLocale, locales };

  let changed = false;
  const next = artboards.map((board) => {
    const ids = new Set(board.elements.map((el) => el.id));
    const swept = sweepBoardOverrides(board, seen, ids);
    const withConfig =
      swept.localization === localization ? swept : { ...swept, localization };
    if (withConfig !== board) changed = true;
    return withConfig;
  });
  return changed ? next : artboards;
}

/** Drops override maps for unknown locales and entries for missing elements. */
function sweepBoardOverrides(
  board: ArtboardState,
  validLocales: Set<string>,
  validElementIds: Set<string>
): ArtboardState {
  const localized = board.localized;
  if (!localized) return board;

  let changed = false;
  const nextLocalized: Record<string, Record<string, ElementLocaleOverride>> = {};
  for (const [locale, map] of Object.entries(localized)) {
    if (!validLocales.has(locale) || !map) {
      changed = true;
      continue;
    }
    const kept: Record<string, ElementLocaleOverride> = {};
    let keptAny = false;
    let sweptHere = false;
    for (const [elementId, override] of Object.entries(map)) {
      if (!validElementIds.has(elementId) || !override) {
        sweptHere = true;
        continue;
      }
      kept[elementId] = override;
      keptAny = true;
    }
    if (sweptHere) changed = true;
    // An emptied locale map is dropped rather than kept as {}, so
    // `board.localized?.[locale]` reads as "nothing translated here".
    if (keptAny) nextLocalized[locale] = sweptHere ? kept : map;
    else changed = true;
  }
  if (!changed) return board;
  if (Object.keys(nextLocalized).length === 0) {
    const { localized: _dropped, ...rest } = board;
    return rest as ArtboardState;
  }
  return { ...board, localized: nextLocalized };
}

export function getBaseLocale(artboards: ArtboardState[]): string {
  return getLocalization(artboards)?.baseLocale || DEFAULT_BASE_LOCALE;
}

/**
 * What to offer as the base language for a project that has none yet: the
 * language every board was last translated into, when they agree on one.
 * `ArtboardState.language` is a translate code on older projects and a store
 * locale on newer ones, so both spellings are looked up.
 *
 * Only a seed. Once a project has export languages the base is locked, because
 * reassigning it re-points every override at a different source string.
 */
export function seedBaseLocale(artboards: ArtboardState[]): string {
  if (artboards.length === 0) return DEFAULT_BASE_LOCALE;
  const first = artboards[0].language;
  if (!first || artboards.some((board) => board.language !== first)) return DEFAULT_BASE_LOCALE;
  return (
    LOCALES.find((def) => def.code === first)?.code ||
    LOCALES.find((def) => def.translateCode === first)?.code ||
    DEFAULT_BASE_LOCALE
  );
}

/**
 * True when an override row has nothing left to say, so the writer that just
 * emptied it should drop it rather than leave a marker behind.
 *
 * The `detached` check is the reason this is shared rather than reimplemented
 * per writer: an element can hold a per-language POSITION and no text at all,
 * and a copy of this test that only looked at the value keys would delete that
 * position the moment someone cleared the translation above it.
 *
 * Deliberately not the same question as the two private helpers in this file
 * and in project.ts. `overrideStateFor` asks "does this cell carry copy", which
 * a detached position must not answer yes to, and projection asks "would this
 * change what is drawn", which a non-detached fontFamily does not.
 */
export function isOverrideEmpty(ov: ElementLocaleOverride | undefined): boolean {
  return (
    !ov ||
    ((!ov.detached || ov.detached.length === 0) &&
      ov.content === undefined &&
      ov.fontFamily === undefined &&
      ov.screenshotSrc === undefined &&
      ov.imageSrc === undefined &&
      ov.mediaId === undefined &&
      ov.hidden === undefined)
  );
}

/** The export languages, never including the base one. */
export function getProjectLocales(artboards: ArtboardState[]): LocaleEntry[] {
  const localization = getLocalization(artboards);
  if (!localization) return [];
  const baseLocale = localization.baseLocale || DEFAULT_BASE_LOCALE;
  return (localization.locales || []).filter((entry) => entry?.code && entry.code !== baseLocale);
}

export function hasLocales(artboards: ArtboardState[]): boolean {
  return getProjectLocales(artboards).length > 0;
}

/**
 * The text elements a language is expected to fill in. Empty strings are not
 * counted: a spacer layer nobody can see would otherwise make every language
 * permanently incomplete.
 */
export function localizableTextElements(board: ArtboardState): TextElementProps[] {
  return board.elements.filter(
    (el): el is TextElementProps => el.type === 'text' && !!el.content && el.content.trim().length > 0
  );
}

/** The "4/6" on a language chip. Counts every board in the project. */
export function localeCompletion(
  artboards: ArtboardState[],
  locale: string
): { translated: number; total: number } {
  let translated = 0;
  let total = 0;
  for (const board of artboards) {
    const map = board.localized?.[locale];
    for (const el of localizableTextElements(board)) {
      total++;
      const content = map?.[el.id]?.content;
      if (content && content.trim().length > 0) translated++;
    }
  }
  return { translated, total };
}

export function untranslatedCount(artboards: ArtboardState[], locale: string): number {
  const { translated, total } = localeCompletion(artboards, locale);
  return total - translated;
}

/**
 * The base value an override was derived from, so the writer and the staleness
 * check always hash the same string. Text is the common case; a screenshot
 * override tracks the base screenshot it replaced.
 */
export function overrideSourceValue(
  baseEl: ArtboardElement,
  override: ElementLocaleOverride
): string | undefined {
  if (override.content !== undefined && baseEl.type === 'text') return baseEl.content;
  if (override.screenshotSrc !== undefined && baseEl.type === 'device') return baseEl.screenshotSrc;
  if (override.imageSrc !== undefined && baseEl.type === 'image') return baseEl.imageSrc;
  if (override.mediaId !== undefined && (baseEl.type === 'video' || baseEl.type === 'video-device')) {
    return baseEl.mediaId;
  }
  if (override.fontFamily !== undefined && baseEl.type === 'text') return baseEl.fontFamily;
  return undefined;
}

/**
 * True when the base value changed after this override was written. An override
 * with no sourceHash is never stale: it came from a CSV import or an older
 * build, and flagging every one of those amber on first load would train the
 * user to ignore the flag.
 */
export function isStaleOverride(baseEl: ArtboardElement, ov: ElementLocaleOverride): boolean {
  if (!ov.sourceHash) return false;
  const source = overrideSourceValue(baseEl, ov);
  if (source === undefined) return false;
  return hash32(source) !== ov.sourceHash;
}

/** True when the override says nothing, so the element falls back to base. */
function isEmptyOverride(ov: ElementLocaleOverride | undefined): boolean {
  return (
    !ov ||
    (ov.content === undefined &&
      ov.fontFamily === undefined &&
      ov.screenshotSrc === undefined &&
      ov.imageSrc === undefined &&
      ov.mediaId === undefined &&
      ov.hidden === undefined)
  );
}

/**
 * What the translation table draws in a cell. An override with no `origin` is
 * treated as manual: it was typed, imported, or written by a build that did not
 * record one, and the safe reading of "we do not know who wrote this" is "do
 * not overwrite it".
 */
export function overrideStateFor(
  baseEl: ArtboardElement,
  ov: ElementLocaleOverride | undefined
): 'inherited' | 'manual' | 'auto' | 'stale-manual' | 'stale-auto' {
  if (isEmptyOverride(ov) || !ov) return 'inherited';
  const stale = isStaleOverride(baseEl, ov);
  if (ov.origin === 'auto') return stale ? 'stale-auto' : 'auto';
  return stale ? 'stale-manual' : 'manual';
}

/**
 * Re-mints element ids that repeat ACROSS boards, keeping the first occurrence.
 *
 * handleDuplicateArtboard used to clone a board without re-minting its element
 * ids, and handleUpdateElementById patches EVERY board holding an id, so the
 * aliasing was mostly invisible. Keyed override maps make it data corruption:
 * one German headline would write itself into two boards. Runs on load so
 * projects already damaged by an older build are repaired.
 */
export function ensureUniqueElementIds(artboards: ArtboardState[]): ArtboardState[] {
  const seen = new Set<string>();
  let changed = false;
  const stamp = Date.now();
  let minted = 0;

  const next = artboards.map((board) => {
    const idMap: Record<string, string> = {};
    const elements = board.elements.map((el) => {
      if (!seen.has(el.id)) {
        seen.add(el.id);
        return el;
      }
      // Same shape as add_elements, with a counter, because two ids minted in
      // the same millisecond would otherwise collide all over again.
      const id = `el_${stamp}_${minted++}_${Math.random().toString(36).slice(2, 7)}`;
      seen.add(id);
      idMap[el.id] = id;
      return { ...el, id };
    });
    if (Object.keys(idMap).length === 0) return board;
    changed = true;
    return remapOverrideIds({ ...board, elements }, idMap);
  });

  return changed ? next : artboards;
}

/**
 * Drops these elements' overrides in EVERY locale. Called in the same commit as
 * a delete, so an id can never come back to a stale translation.
 */
export function dropElementOverrides(board: ArtboardState, elementIds: string[]): ArtboardState {
  if (!board.localized || elementIds.length === 0) return board;
  const doomed = new Set(elementIds);
  const kept = new Set(board.elements.map((el) => el.id).filter((id) => !doomed.has(id)));
  return sweepBoardOverrides(board, new Set(Object.keys(board.localized)), kept);
}

/** Follows an element id change into every locale's override map. */
export function remapOverrideIds(board: ArtboardState, idMap: Record<string, string>): ArtboardState {
  if (!board.localized || Object.keys(idMap).length === 0) return board;
  let changed = false;
  const localized: Record<string, Record<string, ElementLocaleOverride>> = {};
  for (const [locale, map] of Object.entries(board.localized)) {
    const next: Record<string, ElementLocaleOverride> = {};
    for (const [elementId, override] of Object.entries(map)) {
      const mapped = idMap[elementId];
      if (mapped) changed = true;
      next[mapped || elementId] = override;
    }
    localized[locale] = next;
  }
  return changed ? { ...board, localized } : board;
}
