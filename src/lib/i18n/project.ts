// The locale overlay: base document <-> what the user sees in one language.
//
// Two pure functions and their inverse relationship are the whole feature.
// Everything above them (canvas, preview, export, MCP) keeps handing an
// ArtboardState[] to renderers that have never heard of a locale, so no
// renderer can drift out of step with another.
//
// The rule that makes "design once, translate many" true is the short list in
// LOCALIZABLE_KEYS. A property outside that list cannot differ between
// languages, so moving a headline while looking at German moves it in every
// language, with no sync pass, no reconciliation job, and nothing to get stuck.
//
// The rule that makes this safe to ship is identity: for a project with no
// languages, projectArtboards returns its input BY REFERENCE. Every project
// that exists today takes that path and nothing about it changes.

import type {
  ArtboardElement,
  ArtboardState,
  ElementLocaleOverride,
  LocaleEntry,
  TextElementProps,
} from '@/types/artboard';
import { measureTextHeight } from '@/lib/textFit';
import { getRecommendedFontForLanguage } from '@/lib/fontLanguageMatcher';
import { DEFAULT_BASE_LOCALE, getLocaleDef } from './locales';
import { getLocalization, overrideSourceValue } from './localization';
import { hash32 } from './hash';

/**
 * Always per language, because they ARE the language. Editing one of these in a
 * locale view writes that locale's override and never touches the base.
 */
export const ALWAYS_LOCAL_KEYS = [
  'content',
  'screenshotSrc',
  'imageSrc',
  'mediaId',
] as const;

/**
 * Bookkeeping and identity. Everything else an element carries is detachable,
 * which is deliberate: an allowlist could never cover every property of seven
 * element types, and the properties people actually need per language are not
 * predictable. An Arabic layout wants the icon on the right, so `position` has
 * to be as detachable as `fontSize`.
 *
 * `name`, `groupId`, `groupName` and `libraryId` stay out because they identify
 * the layer rather than draw it, and `animation` because a video timeline that
 * differed per language would desynchronise the export.
 */
const NEVER_DETACHABLE = new Set<string>([
  'id',
  'type',
  'name',
  'groupId',
  'groupName',
  'libraryId',
  'animation',
  ...ALWAYS_LOCAL_KEYS,
]);

/**
 * Any drawing property of any element can be pulled apart for one language.
 * Shared by default is still the whole point: if everything differed by default
 * there would be nothing to propagate and this would be the duplicate model
 * with extra steps. Detaching is always the user saying so.
 */
export type DetachableKey = string;

export function isDetachableKey(key: string): boolean {
  return !NEVER_DETACHABLE.has(key);
}

/**
 * Kept for the callers that iterate a known set (the translation table, the
 * staleness check). It is the ALWAYS-local surface, not the whole detachable
 * one, which no longer has a fixed shape.
 */
export const LOCALIZABLE_KEYS = ALWAYS_LOCAL_KEYS;

type LocalizableKey = (typeof ALWAYS_LOCAL_KEYS)[number];

const ALWAYS_LOCAL = new Set<string>(ALWAYS_LOCAL_KEYS);

/** True when this element keeps its own copy of `key` in this language. */
export function isDetached(ov: ElementLocaleOverride | undefined, key: string): boolean {
  return !!ov?.detached?.includes(key);
}

/**
 * Pull one property apart for this language, seeded with what it currently
 * renders as, so detaching alone never changes the picture.
 */
export function detachProperty(
  ov: ElementLocaleOverride | undefined,
  resolvedEl: ArtboardElement,
  key: DetachableKey
): ElementLocaleOverride {
  if (!isDetachableKey(key)) return ov ?? {};
  const next: ElementLocaleOverride = { ...(ov || {}) };
  next.detached = Array.from(new Set([...(next.detached || []), key]));
  const value = (resolvedEl as unknown as Record<string, unknown>)[key];
  // Objects have to be copied, not aliased: position and size are shared with
  // the base element, and a later drag mutating one would silently move both.
  (next as unknown as Record<string, unknown>)[key] =
    value && typeof value === 'object' ? structuredClone(value) : value;
  return next;
}

/** Hand one property back to the shared design. */
export function attachProperty(
  ov: ElementLocaleOverride | undefined,
  key: DetachableKey
): ElementLocaleOverride | undefined {
  if (!ov) return ov;
  const next: ElementLocaleOverride = { ...ov };
  next.detached = (next.detached || []).filter((k) => k !== key);
  if (next.detached.length === 0) delete next.detached;
  delete (next as unknown as Record<string, unknown>)[key];
  return isEmptyOverride(next) ? undefined : next;
}

/**
 * Never routed to the base element by unproject: identity, or always per
 * language. Detachable keys are deliberately NOT here, because while they are
 * attached an edit to them is a design change that must reach every language.
 * The base loop skips them individually once detached.
 */
const NEVER_WRITTEN_TO_BASE = new Set<string>([...ALWAYS_LOCAL_KEYS, 'id', 'type', 'detached']);

/** Board properties the view is not allowed to speak for. */
const BOARD_KEYS_NOT_FROM_VIEW = new Set<string>(['elements', 'localized', 'localization']);

/** How far a translation may shrink before we give up and say it is too long. */
const MIN_RATIO = 0.6;

function devError(message: string, detail?: unknown): void {
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.error(`[i18n] ${message}`, detail ?? '');
  }
}

/**
 * Which element types an ALWAYS-local key means anything for. Detached keys
 * need no equivalent: the user detached one from a control that exists on that
 * element, so it is valid on it by construction.
 */
function acceptsKey(el: ArtboardElement, key: LocalizableKey): boolean {
  switch (key) {
    case 'content':
      return el.type === 'text';
    case 'screenshotSrc':
      return el.type === 'device';
    case 'imageSrc':
      return el.type === 'image';
    case 'mediaId':
      return el.type === 'video' || el.type === 'video-device';
    default:
      return false;
  }
}

/**
 * Values here are strings, numbers, and small plain objects (position, size,
 * shadow). Nested objects keep their identity through a projection unless they
 * were actually edited, so the stringify path is the rare case, not the hot one.
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a === null || b === null) return false;
  if (typeof a === 'object' && typeof b === 'object') {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}

function isEmptyOverride(ov: ElementLocaleOverride | undefined): ov is undefined {
  if (!ov) return true;
  // A detach with no value yet still says something: this element is under
  // manual control in this language, so the override has to survive.
  if (ov.detached && ov.detached.length > 0) return false;
  if (ov.hidden !== undefined) return false;
  const record = ov as unknown as Record<string, unknown>;
  return ALWAYS_LOCAL_KEYS.every((key) => record[key] === undefined);
}

/** The family autoFont would substitute for this locale, if any. */
function autoFamilyFor(entry: LocaleEntry | undefined): string | undefined {
  if (!entry || entry.autoFont === false) return undefined;
  const def = getLocaleDef(entry.code);
  return getRecommendedFontForLanguage(def?.translateCode || entry.code);
}

// --- derived font size -------------------------------------------------------

const fontSizeCache = new Map<string, number>();

function cacheKey(el: TextElementProps, content: string): string {
  return [
    el.fontSize,
    el.size.width,
    el.size.height,
    el.scale || 1,
    el.fontFamily || '',
    el.fontWeight || '',
    el.fontStyle || '',
    el.lineHeight || '',
    el.letterSpacing || 0,
    content,
  ].join('\u0000');
}

/**
 * Forgets every measurement. The probe measures with whatever face is loaded at
 * the time, so a size computed before a webfont arrived is measured against the
 * fallback and is wrong by however much the two differ in width.
 */
export function clearLocaleFontSizeCache(): void {
  fontSizeCache.clear();
}

// Faces load after first paint, so the first measurements of a session are
// taken against fallbacks. One sweep when the document says it is done is
// enough; SSR has no document and no fonts to wait for.
if (typeof document !== 'undefined' && document.fonts?.ready) {
  document.fonts.ready.then(clearLocaleFontSizeCache).catch(() => {
    /* a browser that cannot report font loading just keeps the first pass */
  });
}

/**
 * Largest fontSize at or below the element's own that lets `content` fit the
 * EXISTING box. DERIVED, never stored, so a later change to the base size or
 * the box recomputes automatically and no language can be left behind at a
 * stale size.
 *
 * Returns the base size when it already fits, when nothing down to MIN_RATIO
 * does (the translation table flags that row "too long"), and in any context
 * without a DOM. This runs during render, so it degrades rather than throws.
 */
export function resolveLocaleFontSize(el: TextElementProps, content: string): number {
  const base = el.fontSize;
  if (typeof document === 'undefined') return base;
  if (!(base > 0) || !(el.size?.height > 0) || !content) return base;

  const key = cacheKey(el, content);
  const cached = fontSizeCache.get(key);
  if (cached !== undefined) return cached;

  let result = base;
  try {
    const fits = (size: number): boolean => {
      const needed = measureTextHeight({ ...el, fontSize: size }, content);
      // 0 means "could not measure", which must read as "leave it alone".
      // 1px of slack, matching fitTextBox: sub-pixel rounding resizes nothing.
      return needed === 0 || needed <= el.size.height + 1;
    };
    if (!fits(base)) {
      let lo = base * MIN_RATIO;
      if (fits(lo)) {
        let hi = base;
        // Bisection rather than a step-down loop: eight layouts instead of
        // twenty, and this can run for every text element on a language switch.
        for (let i = 0; i < 8 && hi - lo > 0.25; i++) {
          const mid = (lo + hi) / 2;
          if (fits(mid)) lo = mid;
          else hi = mid;
        }
        result = Math.floor(lo * 10) / 10;
      }
    }
  } catch {
    result = base;
  }

  fontSizeCache.set(key, result);
  return result;
}

// --- projection --------------------------------------------------------------

/**
 * One element as `locale` shows it. Returns the element BY REFERENCE when it
 * has no override, which is deliberate and is the rule the whole feature reads
 * by: an untranslated string shows the base string in the base face, at the
 * base size. Auto font substitution and auto shrinking only apply once a
 * language actually has something of its own to say about the element,
 * otherwise switching to Japanese would redraw every English headline in a CJK
 * face for no gain.
 */
export function resolveElementForLocale(
  el: ArtboardElement,
  ov: ElementLocaleOverride | undefined,
  entry: LocaleEntry | undefined
): ArtboardElement {
  if (isEmptyOverride(ov)) return el;

  let next: ArtboardElement = el;
  const assign = (key: string, value: unknown) => {
    if (next === el) next = { ...el } as ArtboardElement;
    (next as unknown as Record<string, unknown>)[key] = value;
  };

  const baseRecord = el as unknown as Record<string, unknown>;
  const overrideRecord = ov as unknown as Record<string, unknown>;

  for (const key of ALWAYS_LOCAL_KEYS) {
    const value = overrideRecord[key];
    if (value === undefined || !acceptsKey(el, key)) continue;
    if (baseRecord[key] === value) continue;
    assign(key, value);
  }

  // Anything the user pulled apart, whatever it is. Driven by the `detached`
  // list rather than a fixed set of keys, so a property nobody anticipated
  // needing per language still works the moment a control offers the toggle.
  for (const key of ov.detached || []) {
    if (!isDetachableKey(key)) continue;
    const value = overrideRecord[key];
    if (value === undefined) continue;
    if (baseRecord[key] === value) continue;
    assign(key, value);
  }

  if (el.type !== 'text') return next;

  // The auto substitutions are conveniences for languages the user has NOT
  // taken manual control of. Detaching either one is how you say "I am choosing
  // this myself", so they stand down.
  if (!isDetached(ov, 'fontFamily')) {
    const family = autoFamilyFor(entry);
    if (family && family !== (next as TextElementProps).fontFamily) assign('fontFamily', family);
  }

  if (entry?.autoFit !== false && !isDetached(ov, 'fontSize')) {
    const text = next as TextElementProps;
    const size = resolveLocaleFontSize(text, text.content);
    if (size !== text.fontSize) assign('fontSize', size);
  }

  return next;
}

/**
 * base document -> what the user sees in `locale`.
 *
 * Returns `base` BY REFERENCE when the project has no languages, when the base
 * language is showing, or when the locale is one nobody added, which is every
 * project that exists today. Boards and elements with nothing to override come
 * back by reference too, so a language switch re-renders the boards that
 * changed and no others.
 */
export function projectArtboards(base: ArtboardState[], locale: string | null): ArtboardState[] {
  if (!locale) return base;
  const localization = getLocalization(base);
  if (!localization) return base;
  if (locale === (localization.baseLocale || DEFAULT_BASE_LOCALE)) return base;
  const entry = (localization.locales || []).find((candidate) => candidate?.code === locale);
  if (!entry) return base;

  let changed = false;
  const projected = base.map((board) => {
    const overrides = board.localized?.[locale];
    if (!overrides) return board;

    let boardChanged = false;
    const elements: ArtboardElement[] = [];
    for (const el of board.elements) {
      const ov = overrides[el.id];
      // Hidden is expressed by absence, so every renderer gets it for free and
      // none of them needs to learn the word "locale". unprojectArtboards reads
      // the same absence back as hidden, never as a delete.
      if (ov?.hidden) {
        boardChanged = true;
        continue;
      }
      const resolved = resolveElementForLocale(el, ov, entry);
      if (resolved !== el) boardChanged = true;
      elements.push(resolved);
    }
    if (!boardChanged) return board;
    changed = true;
    return { ...board, elements };
  });

  return changed ? projected : base;
}

// --- unprojection ------------------------------------------------------------

interface ElementUnprojection {
  baseEl: ArtboardElement;
  override: ElementLocaleOverride | undefined;
  overrideChanged: boolean;
}

function unprojectElement(
  baseEl: ArtboardElement,
  projEl: ArtboardElement,
  viewEl: ArtboardElement,
  current: ElementLocaleOverride | undefined,
  entry: LocaleEntry | undefined,
  options: UnprojectOptions = {}
): ElementUnprojection {
  const baseRecord = baseEl as unknown as Record<string, unknown>;
  const projRecord = projEl as unknown as Record<string, unknown>;
  const viewRecord = viewEl as unknown as Record<string, unknown>;

  let nextBase = baseEl;
  const setBase = (key: string, value: unknown) => {
    if (nextBase === baseEl) nextBase = { ...baseEl } as ArtboardElement;
    const record = nextBase as unknown as Record<string, unknown>;
    if (value === undefined) delete record[key];
    else record[key] = value;
  };

  let override = current;
  let overrideChanged = false;
  const setOverrideKey = (key: string, value: unknown) => {
    // `!override` matters as well as `!overrideChanged`: the empty-override
    // sweep below can null it out, and autoDetach writes keys after that.
    if (!overrideChanged || !override) {
      override = { ...(override || current || {}) };
      overrideChanged = true;
    }
    const record = override as unknown as Record<string, unknown>;
    if (value === undefined) delete record[key];
    else record[key] = value;
  };

  // 1. The always-local keys: text and media, which ARE the language.
  for (const key of ALWAYS_LOCAL_KEYS) {
    if (!acceptsKey(baseEl, key)) continue;
    const raw = viewRecord[key];
    if (sameValue(raw, projRecord[key])) continue;

    // An absent value and an empty one are the same edit here: a value can only
    // be suppressed for one language by writing an empty string, because
    // "absent" in an override means "inherit".
    const viewValue = typeof raw === 'string' ? raw : '';
    const baseValue = typeof baseRecord[key] === 'string' ? (baseRecord[key] as string) : '';
    // Empty text is how the translation table says "untranslated", so it falls
    // back rather than rendering a blank headline in one language.
    const inherits = viewValue === baseValue || (viewValue === '' && key === 'content');
    if (inherits) {
      if ((current as unknown as Record<string, unknown>)?.[key] !== undefined) {
        setOverrideKey(key, undefined);
      }
      continue;
    }
    setOverrideKey(key, viewValue);
  }

  // 2. Whatever this element has pulled apart in this language, whatever type
  //    it is. Anything NOT in this list is shared, so an edit to it falls
  //    through to the base loop below and reaches every language. That is the
  //    line that keeps "change the design once" true.
  for (const key of current?.detached || []) {
    if (!isDetachableKey(key)) continue;
    const raw = viewRecord[key];
    if (sameValue(raw, projRecord[key])) continue;
    // The auto-substituted family is derived, so a value landing exactly on it
    // is the matcher working, not a choice worth freezing.
    if (key === 'fontFamily' && raw === autoFamilyFor(entry)) continue;
    setOverrideKey(key, raw);
  }

  if (overrideChanged && override) {
    // A person made this edit, so nothing may refresh it without an explicit
    // opt-in, and it is measured against the base value as it reads right now.
    override.origin = 'manual';
    const source = overrideSourceValue(baseEl, override);
    if (source === undefined) delete override.sourceHash;
    else override.sourceHash = hash32(source);
    if (isEmptyOverride(override)) override = undefined;
  }

  const derivedFontSize = (): number => {
    if (baseEl.type !== 'text') return 0;
    if (entry?.autoFit === false) return baseEl.fontSize;
    const probe = { ...(viewEl as TextElementProps), fontSize: baseEl.fontSize };
    return resolveLocaleFontSize(probe, probe.content);
  };

  const keys = new Set([...Object.keys(projRecord), ...Object.keys(viewRecord)]);
  for (const key of keys) {
    if (NEVER_WRITTEN_TO_BASE.has(key)) continue;
    // Detached for this language, so the override loop above already took it.
    // Letting it through here would write one language's choice onto all of them.
    if (isDetached(current, key)) continue;
    if (sameValue(viewRecord[key], projRecord[key])) continue;
    // fontSize is DERIVED in a locale view. A diff that lands exactly on the
    // derived value is the shrink doing its job, and writing it to the base
    // would silently retype the design every time somebody switched language.
    if (key === 'fontSize' && baseEl.type === 'text' && sameValue(viewRecord[key], derivedFontSize())) {
      continue;
    }
    // "This language only" mode: pull the property apart on the spot instead of
    // reaching every language. Recorded in `detached` exactly as an explicit
    // toggle would, so the Properties panel shows it detached afterwards and
    // one click hands it back.
    if (options.autoDetach && isDetachableKey(key)) {
      setOverrideKey(key, viewRecord[key]);
      const already = (overrideChanged ? override : current)?.detached || [];
      if (!already.includes(key)) setOverrideKey('detached', [...already, key]);
      continue;
    }
    setBase(key, viewRecord[key]);
  }

  return { baseEl: nextBase, override, overrideChanged };
}

/**
 * what the user sees, after a property edit -> base document.
 *
 * A changed key in LOCALIZABLE_KEYS becomes an override for this language
 * alone. Everything else is written straight to the base element and so reaches
 * every language, which is the whole point and is announced in the UI.
 *
 * INVARIANT, asserted in dev: board count, board order and per-board element
 * count are unchanged. Elements in base but missing from the view are `hidden`
 * in this locale, never deleted. Structural operations (add, delete, reorder,
 * paste) run on the base array and never come through here, so a count that
 * does not line up means something is wrong and the commit is dropped whole
 * rather than persisted half applied.
 */
export interface UnprojectOptions {
  /**
   * "This language only" mode. Any detachable property the user changes is
   * pulled apart for this language automatically instead of being written to
   * the shared design.
   *
   * This is what makes the feature usable rather than merely correct: when you
   * are LOOKING at German and you drag a box taller because the German string
   * overran it, you mean German. Requiring a detach click first meant the
   * obvious action silently reflowed every other language.
   *
   * Off means the opposite and equally valid intent: edit any language, change
   * the design everywhere.
   */
  autoDetach?: boolean;
}

export function unprojectArtboards(
  base: ArtboardState[],
  locale: string | null,
  view: ArtboardState[],
  options: UnprojectOptions = {}
): ArtboardState[] {
  if (!locale) return view;
  const localization = getLocalization(base);
  if (!localization) return view;
  if (locale === (localization.baseLocale || DEFAULT_BASE_LOCALE)) return view;
  const entry = (localization.locales || []).find((candidate) => candidate?.code === locale);
  if (!entry) return view;

  const projected = projectArtboards(base, locale);
  if (projected.length !== view.length) {
    devError('board count changed in a locale view, dropping the commit', {
      locale,
      expected: projected.length,
      got: view.length,
    });
    return base;
  }

  let failed = false;
  let changed = false;

  const next = base.map((baseBoard, index) => {
    if (failed) return baseBoard;
    const projBoard = projected[index];
    const viewBoard = view[index];
    if (projBoard.id !== viewBoard.id) {
      devError('board order changed in a locale view, dropping the commit', {
        locale,
        expected: projBoard.id,
        got: viewBoard.id,
      });
      failed = true;
      return baseBoard;
    }
    if (projBoard.elements.length !== viewBoard.elements.length) {
      devError('element count changed in a locale view, dropping the commit', {
        locale,
        board: baseBoard.id,
        expected: projBoard.elements.length,
        got: viewBoard.elements.length,
      });
      failed = true;
      return baseBoard;
    }
    if (viewBoard === projBoard) return baseBoard;

    let nextBoard = baseBoard;
    const setBoard = (key: string, value: unknown) => {
      if (nextBoard === baseBoard) nextBoard = { ...baseBoard };
      const record = nextBoard as unknown as Record<string, unknown>;
      if (value === undefined) delete record[key];
      else record[key] = value;
    };

    const projBoardRecord = projBoard as unknown as Record<string, unknown>;
    const viewBoardRecord = viewBoard as unknown as Record<string, unknown>;
    const boardKeys = new Set([...Object.keys(projBoardRecord), ...Object.keys(viewBoardRecord)]);
    for (const key of boardKeys) {
      if (BOARD_KEYS_NOT_FROM_VIEW.has(key)) continue;
      if (sameValue(viewBoardRecord[key], projBoardRecord[key])) continue;
      setBoard(key, viewBoardRecord[key]);
    }

    const projById = new Map(projBoard.elements.map((el) => [el.id, el]));
    const viewById = new Map(viewBoard.elements.map((el) => [el.id, el]));
    for (const el of viewBoard.elements) {
      if (!projById.has(el.id)) {
        devError('element in the locale view is not in the base document, ignoring it', {
          locale,
          board: baseBoard.id,
          element: el.id,
        });
      }
    }

    const currentMap = baseBoard.localized?.[locale];
    let nextMap = currentMap;
    let mapChanged = false;
    const writeOverride = (id: string, ov: ElementLocaleOverride | undefined) => {
      if (!mapChanged) {
        nextMap = { ...(currentMap || {}) };
        mapChanged = true;
      }
      const record = nextMap as Record<string, ElementLocaleOverride>;
      if (ov) record[id] = ov;
      else delete record[id];
    };

    let elementsChanged = false;
    const elements = baseBoard.elements.map((baseEl) => {
      const viewEl = viewById.get(baseEl.id);
      // Missing from the view means hidden in this language. It is the only
      // reading allowed: a delete is a base operation and never arrives here.
      if (!viewEl) return baseEl;
      const projEl = projById.get(baseEl.id) || baseEl;
      if (viewEl === projEl) return baseEl;

      const result = unprojectElement(baseEl, projEl, viewEl, currentMap?.[baseEl.id], entry, options);
      if (result.overrideChanged) writeOverride(baseEl.id, result.override);
      if (result.baseEl !== baseEl) elementsChanged = true;
      return result.baseEl;
    });
    if (elementsChanged) setBoard('elements', elements);

    if (mapChanged) {
      const localized = { ...(baseBoard.localized || {}) };
      if (nextMap && Object.keys(nextMap).length > 0) localized[locale] = nextMap;
      else delete localized[locale];
      setBoard('localized', Object.keys(localized).length > 0 ? localized : undefined);
    }

    if (nextBoard !== baseBoard) changed = true;
    return nextBoard;
  });

  if (failed) return base;
  return changed ? next : base;
}
