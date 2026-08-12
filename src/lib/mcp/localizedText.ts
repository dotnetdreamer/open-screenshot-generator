// Writing one language's copy into the locale overlay, with no React involved.
//
// The MCP server is the only caller: mcpApi hands it the BASE document and
// commits whatever comes back through handleArtboardsUpdate, so an external
// agent writing German follows exactly the same rule every other mutating tool
// follows. Nothing here ever touches a projection.
//
// It lives beside the tools rather than in lib/i18n because the semantics are
// the tool's, not the overlay's: an empty string means "clear this and fall
// back", which is what a caller with no way to delete an argument needs.

import { hash32 } from '@/lib/i18n/hash';
import { isOverrideEmpty, overrideSourceValue } from '@/lib/i18n/localization';
import type {
  ArtboardState,
  ElementLocaleOverride,
  TextElementProps,
} from '@/types/artboard';

export interface LocalizedTextInput {
  /** Already resolved to a real board by the caller. */
  artboardId: string;
  elementId: string;
  locale: string;
  /** Empty, or the same as the base copy, clears the override. */
  text: string;
}

export interface LocalizedTextResult {
  artboardId: string;
  elementId: string;
  locale: string;
  /** The base-language copy this translation stands in for. */
  base: string;
  /** What the language now shows. Null when it fell back to the base copy. */
  text: string | null;
  cleared: boolean;
}

/**
 * Writes `text` as `locale`'s copy for one text element and returns the new base
 * document. Null when the board or the element is not there, or the element is
 * not text, so the tool can report the miss rather than committing nothing.
 *
 * The write is marked `manual`: an agent asked to translate a store screenshot
 * is producing marketing copy, and "Update translations" refreshing it from a
 * machine engine later would quietly replace the better string with a worse one.
 */
export function applyLocalizedText(
  artboards: ArtboardState[],
  input: LocalizedTextInput
): { artboards: ArtboardState[]; result: LocalizedTextResult } | null {
  const boardIndex = artboards.findIndex((board) => board.id === input.artboardId);
  if (boardIndex < 0) return null;
  const board = artboards[boardIndex];
  const element = board.elements.find(
    (el): el is TextElementProps => el.id === input.elementId && el.type === 'text'
  );
  if (!element) return null;

  const current = board.localized?.[input.locale]?.[input.elementId];
  const text = input.text ?? '';
  // Matching the base copy is the same edit as clearing it: an override that
  // repeats the base string only makes the row look translated when it is not.
  const cleared = text.trim().length === 0 || text === element.content;

  const next: ElementLocaleOverride = { ...(current ?? {}) };
  if (cleared) delete next.content;
  else next.content = text;

  const empty = isOverrideEmpty(next);
  if (!empty) {
    next.origin = 'manual';
    // Hashed through the same helper unprojectArtboards uses, so the staleness
    // check can never disagree with the writer about which string it tracked.
    const source = overrideSourceValue(element, next);
    if (source === undefined) delete next.sourceHash;
    else next.sourceHash = hash32(source);
  }

  const result: LocalizedTextResult = {
    artboardId: board.id,
    elementId: element.id,
    locale: input.locale,
    base: element.content,
    text: cleared ? null : text,
    cleared,
  };

  const localeMap = { ...(board.localized?.[input.locale] ?? {}) };
  if (empty) delete localeMap[input.elementId];
  else localeMap[input.elementId] = next;

  const localized = { ...(board.localized ?? {}) };
  // An emptied locale map is dropped rather than kept as {}, so
  // `board.localized?.[locale]` keeps reading as "nothing translated here".
  if (Object.keys(localeMap).length > 0) localized[input.locale] = localeMap;
  else delete localized[input.locale];

  const nextBoard: ArtboardState = { ...board };
  if (Object.keys(localized).length > 0) nextBoard.localized = localized;
  else delete nextBoard.localized;

  const nextArtboards = [...artboards];
  nextArtboards[boardIndex] = nextBoard;
  return { artboards: nextArtboards, result };
}
