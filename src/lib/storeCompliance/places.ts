// The words "Check my app" reads: the text on each artboard of the open
// project, in each of its languages, and the store page Growth keeps. Each is
// a place with a label, so a finding can say where its words are, and the
// page can check that the words the AI quotes are really there (ai.ts).

import { isCreativeBoard, isScreenshotBoard } from '@/lib/creative/specs';
import { isIconBoard } from '@/lib/appIcon/specs';
import { getBaseLocale, getProjectLocales, localizableTextElements } from '@/lib/i18n/localization';
import { getLocaleDef } from '@/lib/i18n/locales';
import { projectArtboards } from '@/lib/i18n/project';
import type { ListingSnapshot } from '@/lib/growth/types';
import type { ArtboardState } from '@/types/artboard';

export interface CheckPlace {
  /** Short and unique, what the AI answers with: "A3 de", "Store page: description". */
  id: string;
  /** For the user. */
  label: string;
  text: string;
  kind: 'artboard' | 'store-page';
}

/** Enough for any real set of screenshots in a few languages, and a prompt that still fits small models. */
export const MAX_CHARACTERS = 16_000;

function languageName(code: string): string {
  return getLocaleDef(code)?.name ?? code;
}

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Every artboard with text, in every language of the project, the base
 * language first. A language whose artboard says the same as the base
 * language adds nothing and is left out. What does not fit in MAX_CHARACTERS
 * is listed in `skipped` (labels), so the screen can say what the AI won't
 * read rather than leave it out quietly.
 */
export function artboardPlaces(artboards: ArtboardState[]): { places: CheckPlace[]; skipped: string[] } {
  const base = getBaseLocale(artboards);
  const others = getProjectLocales(artboards).map((entry) => entry.code);
  const languages = [base, ...others];
  const places: CheckPlace[] = [];
  const skipped: string[] = [];
  const baseText = new Map<string, string>();
  // Screenshots are numbered among themselves, the way the export numbers
  // them, so the app icon and header art at the front don't push them on.
  const shotNumber = new Map(artboards.filter(isScreenshotBoard).map((board, at) => [board.id, at + 1]));
  let total = 0;
  for (const language of languages) {
    const boards = language === base ? artboards : projectArtboards(artboards, language);
    boards.forEach((board, index) => {
      const words = clean(localizableTextElements(board).map((element) => element.content).join(' / '));
      if (!words) return;
      if (language !== base && baseText.get(board.id) === words) return;
      if (language === base) baseText.set(board.id, words);
      const kind = isIconBoard(board) ? 'App icon' : isCreativeBoard(board) ? 'App Store header art' : `Artboard ${shotNumber.get(board.id) ?? index + 1}`;
      const named = board.name?.trim() ?? '';
      const name = named && !/^artboard\s*\d*$/i.test(named) && named.toLowerCase() !== kind.toLowerCase() ? ` "${named}"` : '';
      const label = `${kind}${name}${languages.length > 1 ? `, ${languageName(language)}` : ''}`;
      if (total + words.length > MAX_CHARACTERS) {
        skipped.push(label);
        return;
      }
      total += words.length;
      places.push({ id: `A${index + 1}${languages.length > 1 ? ` ${language}` : ''}`, label, text: words, kind: 'artboard' });
    });
  }
  return { places, skipped };
}

const LISTING_FIELDS: Array<{ key: 'name' | 'subtitle' | 'promotionalText' | 'description' | 'keywords' | 'whatsNew'; label: string }> = [
  { key: 'name', label: 'name' },
  { key: 'subtitle', label: 'subtitle' },
  { key: 'promotionalText', label: 'promotional text' },
  { key: 'description', label: 'description' },
  { key: 'keywords', label: 'keywords' },
  { key: 'whatsNew', label: "what's new" },
];

/** The store page Growth last read, in its first language. */
export function storePagePlaces(listing: ListingSnapshot | null | undefined): CheckPlace[] {
  if (!listing) return [];
  const page = listing.locales.find((entry) => entry.locale === listing.primaryLocale) ?? listing.locales[0];
  if (!page) return [];
  return LISTING_FIELDS.flatMap((field) => {
    const value = clean(page[field.key] ?? '');
    if (!value) return [];
    return [{ id: `Store page: ${field.label}`, label: `Store page ${field.label}`, text: value.slice(0, 4000), kind: 'store-page' as const }];
  });
}

/** How much pasted store page text a check reads; the form says so when there is more. */
export const MAX_PASTED = 6000;

/** Store page text the user pasted, when Growth has none. */
export function pastedPlace(text: string): CheckPlace[] {
  const value = text.trim();
  return value ? [{ id: 'Store page', label: 'Store page text', text: clean(value).slice(0, MAX_PASTED), kind: 'store-page' }] : [];
}

/** Words compared the way a person reads them: case, quotes and spacing aside. */
export function normalizeWords(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019\u201a\u201b]/g, "'")
    .replace(/[\u201c\u201d\u201e\u201f]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}
