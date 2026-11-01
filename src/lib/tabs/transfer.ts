// Elements moving from one project to another.
//
// Pure functions over artboards, so the same transfer serves every way it is
// asked for (dropped on a tab, Move to and Copy to in the canvas menu, a drop
// on another tab's canvas, a paste from the clipboard) and can be tested
// without a browser.
//
// Three things make this more than copying elements over:
//
//   - translations travel with the element, because a move or a paste that
//     left the German behind would lose work. Only the languages the target
//     project has come along, because an override for a language the project
//     lacks is one nothing would ever show.
//   - the base language is the target's. An element holds its project's BASE
//     language and every other language is an override on top, so an element
//     from an English project arriving in a German one is rebuilt with the
//     German as its base and the English as an override (rebaseLanguages).
//   - groups stay groups. Members that move together get one new group id
//     between them, so they arrive grouped and cannot merge with a group the
//     target already has. A member that travels without the rest arrives as a
//     layer of its own.
//
// Media needs nothing: elements carry `asset:<id>` and `mediaId`, and the media
// table is shared by every project.

import type {
  ArtboardElement,
  ArtboardState,
  ElementLocaleOverride,
  LocaleEntry,
  Point,
  Size,
  TextElementProps,
} from '@/types/artboard';
import { unionBounds } from '@/lib/elementGeometry';
import { dropElementOverrides, getLocalization, getProjectLocales, isOverrideEmpty } from '@/lib/i18n/localization';
import { acceptsKey, ALWAYS_LOCAL_KEYS, isDetachableKey, resolveElementForLocale } from '@/lib/i18n/project';
import { DEFAULT_BASE_LOCALE } from '@/lib/i18n/locales';
import { sameContent } from '@/lib/projectCanvas';

/** Translations, locale first, then element id. */
type LocalizedMap = Record<string, Record<string, ElementLocaleOverride>>;

export interface ElementTransfer {
  /** Deep copies, in the source artboard's stacking order. */
  elements: ArtboardElement[];
  /** Their translations, locale then the ORIGINAL element id. */
  localized: LocalizedMap;
  sourceArtboardId: string;
  /** The source artboard's size, to place the set proportionally on another size. */
  sourceSize: Size;
  /** The source project's base language. Absent when it has no languages set up. */
  baseLocale?: string;
  /** The source project's other languages, with the font and fit settings they draw with there. */
  locales?: LocaleEntry[];
}

/** A project's base language, or undefined for a project with no languages set up. */
export function baseLocaleOf(boards: readonly ArtboardState[]): string | undefined {
  const localization = getLocalization(boards as ArtboardState[]);
  return localization ? localization.baseLocale || DEFAULT_BASE_LOCALE : undefined;
}

/** The elements `ids` names on `board`, copied, with their translations. Null when none are there. */
export function pickElements(board: ArtboardState, ids: readonly string[]): ElementTransfer | null {
  const wanted = new Set(ids);
  const elements = board.elements.filter((element) => wanted.has(element.id));
  if (elements.length === 0) return null;
  const localized: LocalizedMap = {};
  for (const [locale, overrides] of Object.entries(board.localized ?? {})) {
    for (const element of elements) {
      const override = overrides?.[element.id];
      if (!override) continue;
      (localized[locale] ??= {})[element.id] = JSON.parse(JSON.stringify(override));
    }
  }
  return {
    elements: JSON.parse(JSON.stringify(elements)),
    localized,
    sourceArtboardId: board.id,
    sourceSize: { width: board.size.width, height: board.size.height },
    baseLocale: baseLocaleOf([board]),
    locales: getProjectLocales([board]),
  };
}

/** The board without the elements, and without their translations. */
export function removeElements(board: ArtboardState, ids: readonly string[]): ArtboardState {
  const doomed = new Set(ids);
  const kept = board.elements.filter((element) => !doomed.has(element.id));
  if (kept.length === board.elements.length) return board;
  return dropElementOverrides({ ...board, elements: kept }, [...doomed]);
}

/**
 * Whether `board` still has the layers `picked` took from it, as they were
 * then: the same elements, with the same translations, none of them gone. A
 * move takes layers out of their project only then, so one edited while its
 * copy was written stays where it is rather than going with a copy that
 * lacks the edit.
 */
export function stillHolds(board: ArtboardState, picked: ElementTransfer): boolean {
  const now = pickElements(board, picked.elements.map((element) => element.id));
  return !!now && sameContent(now.elements, picked.elements) && sameContent(now.localized, picked.localized);
}

/**
 * Pick layers, or an artboard, again until the faces their text is measured
 * in are on the page. `waitFor` answers null when they are, or a promise that
 * settles once they have loaded or been given up on (whenFacesLoaded).
 *
 * What a pick needs can change while it waits: an edit, or one of its
 * project's languages set to draw in a face of its own, which changes no layer
 * at all. So after each wait it is picked again and its faces asked about
 * again, a few times at most, and a set of faces already waited for is not
 * waited for twice: still missing, it could not load. `waited` holds those
 * sets, and passed on to the next call, it keeps that one from waiting again
 * for faces this one gave up on. `pickAgain` answers null when what was
 * picked is gone, and undefined when it cannot have changed (its tab is
 * asleep).
 */
export async function pickWithFacesIn<T>(
  first: T,
  pickAgain: () => T | null | undefined,
  facesOf: (picked: T) => TextFace[],
  waitFor: (faces: readonly TextFace[]) => Promise<void> | null,
  waited: Set<string> = new Set()
): Promise<T | null> {
  let picked = first;
  for (let round = 0; round < 3; round += 1) {
    const faces = facesOf(picked);
    const key = faces
      .map((face) => `${face.font}\n${face.text}`)
      .sort()
      .join('\n\n');
    if (waited.has(key)) break;
    const loading = waitFor(faces);
    if (!loading) break;
    waited.add(key);
    await loading;
    const now = pickAgain();
    if (now === null) return null;
    if (now !== undefined) picked = now;
  }
  return picked;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a === null || b === null) return false;
  return typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b);
}

const copyOf = <T,>(value: T): T => (value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value);

/** The face and size the canvas picks for a language on its own (resolveElementForLocale). */
const DERIVED_KEYS = new Set(['fontFamily', 'fontSize']);

/**
 * What one language needs on top of `base` to draw `view`: its own words and
 * pictures, and every other property it draws differently, pulled apart for
 * it. `own` is what the language said for itself; absent, it is the old base
 * language, whose words are all its own.
 */
function overrideAgainst(
  base: ArtboardElement,
  view: ArtboardElement,
  element: ArtboardElement,
  own: ElementLocaleOverride | undefined
): ElementLocaleOverride {
  const override: ElementLocaleOverride = {};
  const values = override as unknown as Record<string, unknown>;
  const viewValues = view as unknown as Record<string, unknown>;
  const baseValues = base as unknown as Record<string, unknown>;
  const ownValues = own as unknown as Record<string, unknown> | undefined;
  const sourceValues = element as unknown as Record<string, unknown>;

  for (const key of ALWAYS_LOCAL_KEYS) {
    if (!acceptsKey(base, key)) continue;
    // Not translated there: it shows the new base's, like any untranslated element.
    if (own && ownValues?.[key] === undefined) continue;
    const value = viewValues[key];
    if (value === undefined && baseValues[key] === undefined) continue;
    // An empty string is how a language says it has none (unprojectArtboards).
    values[key] = value ?? '';
  }

  for (const key of new Set([...Object.keys(viewValues), ...Object.keys(baseValues)])) {
    if (!isDetachableKey(key)) continue;
    // What the language pulled apart itself stays its own, even where it now
    // matches the base.
    if (!own?.detached?.includes(key)) {
      if (sameValue(viewValues[key], baseValues[key])) continue;
      // Picked by the canvas from a base value that has not changed: the
      // target picks the same face and size from it, and goes on picking.
      if (DERIVED_KEYS.has(key) && sameValue(baseValues[key], sourceValues[key])) continue;
    }
    (override.detached ??= []).push(key);
    // A property it had no value for is stored as null, unset, so it keeps
    // drawing the default rather than whatever the new base sets.
    values[key] = viewValues[key] === undefined ? null : copyOf(viewValues[key]);
  }
  return override;
}

/**
 * Elements written in one base language, rewritten in another's.
 *
 * Every language looks the way it did. Each element becomes what the source
 * drew in the target's base language, the face and size the canvas picked for
 * that language included, because a base language picks none for itself. Each
 * of the target's other languages that had something of its own for the
 * element, the source's base among them, gets an override that says where it
 * differs from that.
 *
 * A language with nothing of its own for the element follows the new base,
 * words and look, the way any untranslated element of that project does. So
 * does a language the source never had.
 *
 * Two things cannot cross: a hidden-in-this-language flag on the language that
 * becomes the base (a base element has no such flag, so it shows), and the
 * staleness marks, which compared against a base text that is not the base any
 * more. Same base language, or a project with none set up: nothing changes.
 */
export function rebaseLanguages(
  elements: ArtboardElement[],
  localized: LocalizedMap,
  source: { baseLocale?: string; locales?: readonly LocaleEntry[] },
  target: { baseLocale?: string; locales: ReadonlySet<string> }
): { elements: ArtboardElement[]; localized: LocalizedMap } {
  const from = source.baseLocale;
  const to = target.baseLocale;
  if (!from || !to || from === to) {
    const kept: LocalizedMap = {};
    for (const [locale, overrides] of Object.entries(localized)) {
      if (target.locales.has(locale)) kept[locale] = overrides;
    }
    return { elements, localized: kept };
  }

  const entryOf = (code: string) => source.locales?.find((entry) => entry.code === code);
  const out: LocalizedMap = {};
  const rebased = elements.map((element) => {
    const asBase = localized[to]?.[element.id];
    const base = asBase
      ? copyOf(resolveElementForLocale(element, { ...asBase, hidden: undefined }, entryOf(to)))
      : element;

    for (const locale of target.locales) {
      if (locale === to) continue;
      const own = locale === from ? undefined : localized[locale]?.[element.id];
      if (locale !== from && isOverrideEmpty(own)) continue;
      const view = own ? resolveElementForLocale(element, own, entryOf(locale)) : element;
      const override = overrideAgainst(base, view, element, own);
      if (own?.hidden) override.hidden = true;
      if (isOverrideEmpty(override)) continue;
      // The source's base text was written by a person, so "Update
      // translations" must never replace it with a machine's.
      if (locale === from) override.origin = 'manual';
      else if (own?.origin) override.origin = own.origin;
      (out[locale] ??= {})[element.id] = override;
    }
    return base;
  });
  return { elements: rebased, localized: out };
}

/** A face text is drawn in, and what is drawn in it. */
export interface TextFace {
  /** The CSS font shorthand, the way `document.fonts` takes it. */
  font: string;
  family: string;
  /** Every character drawn in it, which picks the parts of a split webfont it needs. */
  text: string;
}

/**
 * The faces the text of `elements` is drawn in: in the language they are
 * written in, and in each language that has words of its own for them, where
 * the face can be another one (picked there, or the one the language uses for
 * its script). rebaseLanguages measures text in these faces, so they have to
 * be on the page before it runs (transferFonts.ts).
 */
export function textFacesOf(
  elements: readonly ArtboardElement[],
  localized: Readonly<LocalizedMap> | undefined,
  locales: readonly LocaleEntry[] = []
): TextFace[] {
  const faces = new Map<string, { family: string; chars: Set<string> }>();
  const take = (element: ArtboardElement) => {
    if (element.type !== 'text') return;
    const { fontFamily, fontStyle, fontWeight, content } = element as TextElementProps;
    if (!content) return;
    // The canvas measures an element with no face in Arial (textFit.ts).
    const family = fontFamily || 'Arial';
    // Quoted, unless it is a list of families already.
    const css = family.includes(',') ? family : `"${family.replace(/"/g, '')}"`;
    const font = `${fontStyle || 'normal'} ${fontWeight || 'normal'} 16px ${css}`;
    const face = faces.get(font) ?? { family, chars: new Set<string>() };
    for (const char of content) face.chars.add(char);
    faces.set(font, face);
  };
  for (const element of elements) {
    take(element);
    for (const [code, overrides] of Object.entries(localized ?? {})) {
      const override = overrides?.[element.id];
      if (!override) continue;
      const entry = locales.find((candidate) => candidate.code === code);
      take(resolveElementForLocale(element, override, entry, { fit: false }));
    }
  }
  return [...faces].map(([font, face]) => ({ font, family: face.family, text: [...face.chars].join('') }));
}

export interface PlaceOptions {
  /**
   * Where the middle of the set lands, in the target artboard's pixels. Absent:
   * the same place relative to the artboard, so a headline at the top of one
   * screen arrives at the top of the other whatever their sizes.
   */
  at?: Point;
  /** Instead of `at`: this far from where the set was, as a paste beside what it copied lands. */
  offset?: Point;
  /**
   * The language the target's canvas is showing, when it is not the base one.
   * `at` and `offset` are about where the set is drawn there, which is not
   * where the base puts it when that language has a box of its own.
   */
  viewLocale?: string | null;
  /** The target project's languages beyond its base one. */
  locales: ReadonlySet<string>;
  /** The target project's base language. Absent when it has no languages set up. */
  baseLocale?: string;
  /** Mints an element id. Injected so tests can be deterministic. */
  newId?: () => string;
}

/** The keys that place an element's box, which a language can hold its own of. */
const BOX_KEYS = ['position', 'size', 'rotation', 'scale'] as const;

/** Where `element` is drawn in a language with this override: the box it detached there, else the base one. */
function boxIn(element: ArtboardElement, override: ElementLocaleOverride | undefined): ArtboardElement {
  if (!override?.detached?.length) return element;
  const values = override as unknown as Record<string, unknown>;
  let box = element;
  for (const key of BOX_KEYS) {
    const value = values[key];
    if (!override.detached.includes(key) || value === undefined || value === null) continue;
    box = { ...box, [key]: value } as ArtboardElement;
  }
  return box;
}

let mintedIds = 0;
function defaultId(): string {
  mintedIds += 1;
  return `el_${Date.now()}_${mintedIds}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Put a transfer onto `board`, on top of what is there. Returns the new board
 * and the ids the elements arrived under, which is what the target selects.
 */
export function placeElements(
  board: ArtboardState,
  transfer: ElementTransfer,
  options: PlaceOptions
): { board: ArtboardState; placedIds: string[] } {
  const newId = options.newId ?? defaultId;
  const languages = rebaseLanguages(
    transfer.elements,
    transfer.localized,
    { baseLocale: transfer.baseLocale, locales: transfer.locales },
    { baseLocale: options.baseLocale, locales: options.locales }
  );
  // Measured where the set is drawn in the language on screen: a box of its
  // own there, and without the layers that language hides.
  const shown = options.viewLocale ? languages.localized[options.viewLocale] : undefined;
  const drawn = languages.elements
    .filter((element) => !shown?.[element.id]?.hidden)
    .map((element) => boxIn(element, shown?.[element.id]));
  const bounds = unionBounds(drawn.length > 0 ? drawn : languages.elements);
  const width = bounds?.width ?? 0;
  const height = bounds?.height ?? 0;
  const left = bounds?.x ?? languages.elements[0]?.position.x ?? 0;
  const top = bounds?.y ?? languages.elements[0]?.position.y ?? 0;

  const center =
    options.at ??
    (options.offset
      ? { x: left + width / 2 + options.offset.x, y: top + height / 2 + options.offset.y }
      : {
          x: ((left + width / 2) / Math.max(1, transfer.sourceSize.width)) * board.size.width,
          y: ((top + height / 2) / Math.max(1, transfer.sourceSize.height)) * board.size.height,
        });
  // Kept on the artboard: a set wider than the board stays centred on it, and
  // anything smaller cannot be pushed off an edge.
  const clampAxis = (middle: number, span: number, room: number) =>
    span >= room ? room / 2 : Math.max(span / 2, Math.min(room - span / 2, middle));
  const shiftX = clampAxis(center.x, width, board.size.width) - (left + width / 2);
  const shiftY = clampAxis(center.y, height, board.size.height) - (top + height / 2);

  const members = new Map<string, number>();
  for (const element of languages.elements) {
    if (element.groupId) members.set(element.groupId, (members.get(element.groupId) ?? 0) + 1);
  }
  const ids = new Map<string, string>();
  const groups = new Map<string, string>();
  const placed = languages.elements.map((element) => {
    const id = newId();
    ids.set(element.id, id);
    const position = { x: element.position.x + shiftX, y: element.position.y + shiftY };
    if (element.groupId && (members.get(element.groupId) ?? 0) < 2) {
      // Not a group of one. The keys are dropped rather than set to undefined,
      // which Dexie would store as keys all the same.
      const { groupId: _ungrouped, groupName: _unnamed, ...loose } = element;
      return { ...loose, id, position } as ArtboardElement;
    }
    const copy = { ...element, id, position };
    if (element.groupId) {
      let group = groups.get(element.groupId);
      if (!group) {
        group = `group_${id}`;
        groups.set(element.groupId, group);
      }
      copy.groupId = group;
    }
    return copy as ArtboardElement;
  });

  let localized = board.localized;
  for (const [locale, overrides] of Object.entries(languages.localized)) {
    const next = { ...(localized?.[locale] ?? {}) };
    for (const [oldId, override] of Object.entries(overrides)) {
      const id = ids.get(oldId);
      if (!id) continue;
      // A language with a box of its own moves by the same amount, or its copy
      // of the element would stay behind where the set used to be.
      next[id] = override.position
        ? { ...override, position: { x: override.position.x + shiftX, y: override.position.y + shiftY } }
        : override;
    }
    localized = { ...(localized ?? {}), [locale]: next };
  }

  return {
    board: {
      ...board,
      elements: [...board.elements, ...placed],
      ...(localized ? { localized } : {}),
    },
    placedIds: placed.map((element) => element.id),
  };
}

/**
 * A whole artboard arriving in another project, as a copy with ids of its own.
 *
 * Three things about the board belong to the project it lands in rather than
 * to the board:
 *
 *   - `localization`, the project's language list, mirrored onto every board.
 *     The arriving board takes the target's, its elements are rewritten in the
 *     target's base language (rebaseLanguages), and only the translations for
 *     languages the target has come along.
 *   - a SHARED background picture. `all` and `span` are sticky by design
 *     (normalizeBackgroundImage puts every board without a picture onto the
 *     shared one), so a board arriving with one would repaint the whole target
 *     project. It keeps its picture for itself.
 *   - position and the background slice, which are derived on every commit.
 */
export function placeArtboard(
  boards: readonly ArtboardState[],
  source: ArtboardState,
  options: { index?: number; newId?: () => string; newBoardId?: () => string }
): { boards: ArtboardState[]; boardId: string } {
  const newId = options.newId ?? defaultId;
  const boardId = options.newBoardId?.() ?? `artboard_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const copy: ArtboardState = JSON.parse(JSON.stringify(source));
  const localization = getLocalization(boards as ArtboardState[]);
  const locales = new Set((localization?.locales ?? []).map((entry) => entry.code));
  const languages = rebaseLanguages(
    copy.elements,
    (copy.localized ?? {}) as LocalizedMap,
    { baseLocale: baseLocaleOf([source]), locales: getProjectLocales([copy]) },
    { baseLocale: baseLocaleOf(boards), locales }
  );

  const ids = new Map<string, string>();
  const groups = new Map<string, string>();
  copy.elements = languages.elements.map((element) => {
    const id = newId();
    ids.set(element.id, id);
    const next = { ...element, id };
    if (element.groupId) {
      let group = groups.get(element.groupId);
      if (!group) {
        group = `group_${id}`;
        groups.set(element.groupId, group);
      }
      next.groupId = group;
    }
    return next as ArtboardElement;
  });

  const localized: NonNullable<ArtboardState['localized']> = {};
  for (const [locale, overrides] of Object.entries(languages.localized)) {
    const kept: Record<string, ElementLocaleOverride> = {};
    for (const [oldId, override] of Object.entries(overrides ?? {})) {
      const id = ids.get(oldId);
      if (id) kept[id] = override;
    }
    if (Object.keys(kept).length > 0) localized[locale] = kept;
  }

  const placed: ArtboardState = {
    ...copy,
    id: boardId,
    localized: Object.keys(localized).length > 0 ? localized : undefined,
    localization,
    backgroundImageApply: copy.backgroundImage ? 'board' : copy.backgroundImageApply,
    backgroundImageSlice: undefined,
  };
  if (!placed.localized) delete placed.localized;
  if (!placed.localization) delete placed.localization;
  if (!placed.backgroundImageSlice) delete placed.backgroundImageSlice;

  const at = Math.max(0, Math.min(boards.length, options.index ?? boards.length));
  return { boards: [...boards.slice(0, at), placed, ...boards.slice(at)], boardId };
}
