import { ALL_FONTS, GoogleFont } from '@/services/fontService';

// Maps a language code (from LibreTranslate) to an ordered list of preferred fonts.
const languageFontPreferences: Record<string, string[]> = {
  'ar': ['Noto Sans Arabic', 'Cairo', 'Tajawal', 'Amiri'],         // Arabic
  'fa': ['Noto Sans Arabic', 'Cairo', 'Tajawal', 'Amiri'],         // Persian (uses Arabic script)
  'ur': ['Noto Nastaliq Urdu', 'Noto Sans Urdu', 'Jameel Noori Nastaleeq', 'Noto Sans Arabic'], // Urdu
  
  // Fallbacks for languages that might benefit from multilingual fonts
  'hi': ['Noto Sans'],
  'bn': ['Noto Sans'],
  'zh-Hans': ['Noto Sans'],
  'zh-Hant': ['Noto Sans'],
  'ja': ['Noto Sans'],
  'ko': ['Noto Sans'],
  'th': ['Noto Sans'],
  
  // Latin script languages (using common sans-serif fallbacks)
  'en': ['Inter', 'Roboto Flex', 'Arial'],
};

/**
 * Returns a recommended font family string based on the target language.
 * @param targetLanguageCode The code of the target language (e.g., 'ar', 'en')
 * @returns The best matching font family name, or undefined if no specific match is needed.
 */
export function getRecommendedFontForLanguage(targetLanguageCode: string): string | undefined {
  const preferredFonts = languageFontPreferences[targetLanguageCode];
  
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
