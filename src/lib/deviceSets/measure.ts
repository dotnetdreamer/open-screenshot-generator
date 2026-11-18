// The text measure the layouts use in the browser, and the wait for the fonts
// it measures in.
//
// A line measured in a fallback face breaks somewhere else once the real face
// arrives, and a text box sized for the fallback can then cut the text off
// (rule 3a in .agents/AGENTS.md). So whoever lays a project out for another
// device waits for facesReady first, and measures again when a face arrives
// later (onFontsSettled).

import type { ArtboardState, TextElementProps } from '@/types/artboard';
import { measureTextHeight } from '@/lib/textFit';
import { getProjectLocales } from '@/lib/i18n/localization';
import { textFacesOf } from '@/lib/tabs/transfer';
import { whenFacesLoaded } from '@/lib/tabs/transferFonts';
import type { TextMeasure } from './layout';

export const measureText: TextMeasure = (element: TextElementProps) =>
  measureTextHeight(element, element.content ?? '');

/**
 * Null when every face the artboards' text draws in, in every language of
 * the project, is on the page. Otherwise a promise that settles once they
 * are, or once whenFacesLoaded gives up waiting.
 */
export function facesReady(boards: ArtboardState[]): Promise<void> | null {
  const locales = getProjectLocales(boards);
  const faces = boards.flatMap((board) => textFacesOf(board.elements, board.localized, locales));
  return whenFacesLoaded(faces);
}
