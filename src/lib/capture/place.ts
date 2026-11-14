/**
 * Puts captured screenshots and recordings into frames, one language at a
 * time, as a pure transform of the base document.
 *
 * A screenshot is per language already (`screenshotSrc` and `mediaId` are in
 * ALWAYS_LOCAL_KEYS), so a capture for German writes German's override and
 * leaves every other language as it was. In the base language it is written
 * on the element itself, the way the Upload Screenshot button writes it:
 * with the picture's size and, for a built in device, a screen rect that fills
 * the screen, so it also shows in every language without a screenshot of its
 * own. The other languages share that rect, so it is not touched there.
 *
 * A recording carries its length and size, and any trim was set for the clip
 * it replaces. In the base language they are written on the element. In
 * another language every one of them is kept for that language alone, even
 * when it equals the base value today, so a German clip never plays with the
 * length or the trim of an English clip put in later.
 */

import type { ArtboardElement, ArtboardState, ElementLocaleOverride } from '@/types/artboard';
import { getBaseLocale, getProjectLocales } from '@/lib/i18n/localization';
import { projectArtboards, unprojectArtboards } from '@/lib/i18n/project';

export interface ShotPlacement {
  boardId: string;
  elementId: string;
  /** A project language; null or the base language writes the element itself. */
  locale: string | null;
  ref: string;
  width: number;
  height: number;
}

export interface ClipPlacement {
  boardId: string;
  elementId: string;
  locale: string | null;
  mediaId: string;
  width: number;
  height: number;
  duration: number;
}

export interface PlaceResult {
  artboards: ArtboardState[];
  /** Placements that found no frame: deleted meanwhile, or hidden in that language. */
  missed: number;
}

type ElementEdit = (element: ArtboardElement) => ArtboardElement | null;

function editElement(boards: ArtboardState[], boardId: string, elementId: string, edit: ElementEdit): ArtboardState[] | null {
  let found = false;
  const next = boards.map((board) => {
    if (board.id !== boardId) return board;
    let touched = false;
    const elements = board.elements.map((element) => {
      if (element.id !== elementId) return element;
      const edited = edit(element);
      if (!edited) return element;
      touched = true;
      return edited;
    });
    if (!touched) return board;
    found = true;
    return { ...board, elements };
  });
  return found ? next : null;
}

function placeOne(
  base: ArtboardState[],
  placement: { boardId: string; elementId: string; locale: string | null },
  baseEdit: ElementEdit,
  // Changes only always-local keys, so nothing it writes reaches other languages.
  localEdit: ElementEdit
): ArtboardState[] | null {
  const baseLocale = getBaseLocale(base);
  if (!placement.locale || placement.locale === baseLocale) {
    return editElement(base, placement.boardId, placement.elementId, baseEdit);
  }
  // A language the project does not have: unprojectArtboards would hand the
  // edited view back as the document, and the base screenshot would change.
  if (!getProjectLocales(base).some((entry) => entry.code === placement.locale)) return null;
  const view = projectArtboards(base, placement.locale);
  const edited = editElement(view, placement.boardId, placement.elementId, localEdit);
  if (!edited) return null;
  const next = unprojectArtboards(base, placement.locale, edited);
  // Unchanged means the language is not in the project, or the commit did not line up.
  return next === base ? null : next;
}

export function placeShots(base: ArtboardState[], placements: ShotPlacement[]): PlaceResult {
  let artboards = base;
  let missed = 0;
  for (const placement of placements) {
    const next = placeOne(
      artboards,
      placement,
      (element) =>
        element.type === 'device'
          ? {
              ...element,
              screenshotSrc: placement.ref,
              naturalScreenshotWidth: placement.width,
              naturalScreenshotHeight: placement.height,
              // Mirrors the Upload Screenshot button: a built in device fills
              // its padded screen; only the custom frame keeps a 5% inset.
              screenshotRect:
                element.deviceType === 'custom'
                  ? { left: 5, top: 5, width: 90, height: 90 }
                  : { left: 0, top: 0, width: 100, height: 100 },
            }
          : null,
      (element) => (element.type === 'device' ? { ...element, screenshotSrc: placement.ref } : null)
    );
    if (next) artboards = next;
    else missed += 1;
  }
  return { artboards, missed };
}

/**
 * Writes `values` into one element's override for one language and marks each
 * key as kept there, the way detaching a property in the Properties panel
 * does. A null value is unset in that language, so the base value never shows.
 */
function keepInLanguage(
  boards: ArtboardState[],
  boardId: string,
  elementId: string,
  locale: string,
  values: Record<string, unknown>
): ArtboardState[] {
  return boards.map((board) => {
    if (board.id !== boardId) return board;
    const forLocale = board.localized?.[locale] ?? {};
    const current = forLocale[elementId] ?? {};
    const detached = Array.from(new Set([...(current.detached ?? []), ...Object.keys(values)]));
    const override = { ...current, ...values, detached } as ElementLocaleOverride;
    return { ...board, localized: { ...board.localized, [locale]: { ...forLocale, [elementId]: override } } };
  });
}

export function placeClip(base: ArtboardState[], placement: ClipPlacement): PlaceResult {
  const local = !!placement.locale && placement.locale !== getBaseLocale(base);
  const next = placeOne(
    base,
    placement,
    (element) =>
      element.type === 'video-device'
        ? {
            ...element,
            mediaId: placement.mediaId,
            naturalVideoWidth: placement.width,
            naturalVideoHeight: placement.height,
            durationSeconds: placement.duration,
            trimStart: undefined,
            trimEnd: undefined,
            // A device recording has no sound track.
            keepAudio: undefined,
          }
        : null,
    (element) => (element.type === 'video-device' ? { ...element, mediaId: placement.mediaId } : null)
  );
  if (!next) return { artboards: base, missed: 1 };
  if (!local) return { artboards: next, missed: 0 };
  // Every value that belongs to the clip, kept for this language even when it
  // equals the base value: a value only kept because it differs today would
  // follow the next English clip.
  return {
    artboards: keepInLanguage(next, placement.boardId, placement.elementId, placement.locale as string, {
      naturalVideoWidth: placement.width,
      naturalVideoHeight: placement.height,
      durationSeconds: placement.duration,
      trimStart: null,
      trimEnd: null,
      // A device recording has no sound track.
      keepAudio: null,
    }),
    missed: 0,
  };
}
