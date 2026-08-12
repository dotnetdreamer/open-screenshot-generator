import { ALL_FONTS } from '@/services/fontService';

// Maps a language code (from LibreTranslate) to an ordered list of preferred
// fonts.
//
// Every family listed here has to be one fontService actually loads AND has to
// carry the script's glyphs. Those are two different claims and the second one
// is the one that used to be wrong: 'bn', 'th', 'ja', 'ko' and both Chinese
// codes all pointed at 'Noto Sans', which is a Latin, Cyrillic, Greek and
// Devanagari face. It loads, it matches, and it renders Japanese as tofu.
//
// A Latin-script language gets no entry on purpose. Returning undefined means
// "the design's own typeface is fine", which is true for German and French and
// keeps a translation from silently restyling the whole board.
const languageFontPreferences: Record<string, string[]> = {
  // Arabic script
  'ar': ['Noto Sans Arabic', 'IBM Plex Sans Arabic', 'Cairo', 'Tajawal', 'Amiri'],
  'fa': ['Noto Sans Arabic', 'IBM Plex Sans Arabic', 'Cairo', 'Tajawal', 'Amiri'], // Persian
  'ur': ['Noto Nastaliq Urdu', 'Noto Sans Arabic'],                                // Urdu

  'he': ['Noto Sans Hebrew'],
  'th': ['Noto Sans Thai'],
  'hi': ['Noto Sans Devanagari', 'Noto Sans'],
  'bn': ['Noto Sans Bengali'],

  // CJK. Simplified and Traditional are different faces, not a subset of one
  // another, and Japanese kanji are drawn differently again from the same
  // codepoints in Chinese, so each one gets its own family rather than sharing.
  'ja': ['Noto Sans JP', 'Noto Serif JP'],
  'ko': ['Noto Sans KR'],
  'zh-Hans': ['Noto Sans SC'],
  'zh-Hant': ['Noto Sans TC'],

  // Cyrillic and Greek. Checked against the css2 subset list: these three ship
  // both scripts, so this is a safety net for a design drawn in a Latin-only
  // face, not a substitution anyone needs by default.
  'ru': ['Noto Sans', 'Roboto Flex', 'Fira Sans Condensed'],
  'uk': ['Noto Sans', 'Roboto Flex', 'Fira Sans Condensed'],
  'bg': ['Noto Sans', 'Roboto Flex', 'Fira Sans Condensed'],
  'sr': ['Noto Sans', 'Roboto Flex', 'Fira Sans Condensed'],
  'ky': ['Noto Sans', 'Roboto Flex', 'Fira Sans Condensed'],
  'el': ['Noto Sans', 'Roboto Flex', 'Fira Sans Condensed'],
};

/**
 * Returns a recommended font family string based on the target language.
 * @param targetLanguageCode The code of the target language (e.g., 'ar', 'en')
 * @returns The best matching font family name, or undefined if no specific match is needed.
 */
export function getRecommendedFontForLanguage(targetLanguageCode: string): string | undefined {
  // Callers speak two vocabularies: LibreTranslate codes ('de', 'zh-Hans') from
  // the translate dialog, and store locales ('de-DE', 'ar-SA') from the locale
  // overlay when a language has no translate code at all. Try the code as given
  // first, so 'zh-Hans' and 'zh-Hant' never collapse into each other, then fall
  // back to the primary subtag.
  const preferredFonts =
    languageFontPreferences[targetLanguageCode] ??
    languageFontPreferences[targetLanguageCode.split('-')[0]];

  if (!preferredFonts) {
    // If we have no specific preference, we return undefined so the caller
    // can choose whether to leave the font as-is or use a generic default.
    return undefined;
  }

  // Check against available fonts in the app
  const availableFonts = ALL_FONTS.map(f => f.family);

  // Find the first preferred font that is actually supported
  const matchedFont = preferredFonts.find(font => availableFonts.includes(font));

  return matchedFont;
}
