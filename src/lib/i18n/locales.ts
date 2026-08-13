// The languages a project can be exported in, and how each one maps onto the
// three vocabularies this app has to speak.
//
// The key is the STORE locale ('de-DE', 'zh-Hans', 'pt-BR'), not the translate
// code, because the three vocabularies genuinely differ: LibreTranslate says
// 'de', App Store Connect says 'de-DE', Google Play says 'de-DE' for German but
// 'zh-CN' for Simplified Chinese and 'iw-IL' for Hebrew. Guessing 'de' up to
// 'de-DE' works often enough to hide the cases that matter, which are exactly
// the ones people ship: en-GB against en-US, zh-Hant against zh-Hans.
//
// This is the only registration site for a language, following the
// storeTargets.ts precedent. Adding one here gives it the switcher, the
// translation table, the export filename token and both upload paths at once.
//
// Sources: the LANGUAGES list in TranslateDialog (LibreTranslate's own
// vocabulary), Apple's App Store Connect localization list, and Google Play's
// listing languages.

export interface LocaleDef {
  /** Our key, a store locale. */
  code: string;
  /** English name, for sorting and for search. */
  name: string;
  /** What speakers call it, which is what the UI shows. */
  nativeName: string;
  /** LibreTranslate code. Absent means there is no machine path, type it in. */
  translateCode?: string;
  /** AppStoreLocalization.locale. Absent means Apple has no such localization. */
  appleLocale?: string;
  /** Google Play listing path segment. Absent means Play has no such listing. */
  playLanguage?: string;
  rtl?: boolean;
  script?: 'latin' | 'arabic' | 'hebrew' | 'cjk' | 'cyrillic' | 'devanagari' | 'thai' | 'greek';
}

/** What a project is written in until someone says otherwise. */
export const DEFAULT_BASE_LOCALE = 'en-US';

/** Ordered by English name, which is the order the pickers show. */
export const LOCALES: LocaleDef[] = [
  { code: 'sq', name: 'Albanian', nativeName: 'Shqip', translateCode: 'sq', script: 'latin' },
  { code: 'ar-SA', name: 'Arabic', nativeName: 'العربية', translateCode: 'ar', appleLocale: 'ar-SA', playLanguage: 'ar', rtl: true, script: 'arabic' },
  { code: 'az', name: 'Azerbaijani', nativeName: 'Azərbaycan', translateCode: 'az', script: 'latin' },
  { code: 'eu', name: 'Basque', nativeName: 'Euskara', translateCode: 'eu', playLanguage: 'eu-ES', script: 'latin' },
  // Bengali script has no member in the `script` union yet, and the union is a
  // shared contract, so it stays unset rather than being filed under the wrong
  // one. Nothing reads it for font matching (that goes through translateCode).
  { code: 'bn', name: 'Bengali', nativeName: 'বাংলা', translateCode: 'bn', playLanguage: 'bn-BD' },
  { code: 'bg', name: 'Bulgarian', nativeName: 'Български', translateCode: 'bg', playLanguage: 'bg', script: 'cyrillic' },
  { code: 'ca', name: 'Catalan', nativeName: 'Català', translateCode: 'ca', appleLocale: 'ca', playLanguage: 'ca', script: 'latin' },
  { code: 'zh-Hans', name: 'Chinese (Simplified)', nativeName: '简体中文', translateCode: 'zh-Hans', appleLocale: 'zh-Hans', playLanguage: 'zh-CN', script: 'cjk' },
  { code: 'zh-Hant', name: 'Chinese (Traditional)', nativeName: '繁體中文', translateCode: 'zh-Hant', appleLocale: 'zh-Hant', playLanguage: 'zh-TW', script: 'cjk' },
  { code: 'hr', name: 'Croatian', nativeName: 'Hrvatski', appleLocale: 'hr', playLanguage: 'hr', script: 'latin' },
  { code: 'cs', name: 'Czech', nativeName: 'Čeština', translateCode: 'cs', appleLocale: 'cs', playLanguage: 'cs-CZ', script: 'latin' },
  { code: 'da', name: 'Danish', nativeName: 'Dansk', translateCode: 'da', appleLocale: 'da', playLanguage: 'da-DK', script: 'latin' },
  { code: 'nl-NL', name: 'Dutch', nativeName: 'Nederlands', translateCode: 'nl', appleLocale: 'nl-NL', playLanguage: 'nl-NL', script: 'latin' },
  { code: 'en-AU', name: 'English (Australia)', nativeName: 'English (Australia)', translateCode: 'en', appleLocale: 'en-AU', playLanguage: 'en-AU', script: 'latin' },
  { code: 'en-CA', name: 'English (Canada)', nativeName: 'English (Canada)', translateCode: 'en', appleLocale: 'en-CA', playLanguage: 'en-CA', script: 'latin' },
  { code: 'en-GB', name: 'English (UK)', nativeName: 'English (UK)', translateCode: 'en', appleLocale: 'en-GB', playLanguage: 'en-GB', script: 'latin' },
  { code: 'en-US', name: 'English (US)', nativeName: 'English (US)', translateCode: 'en', appleLocale: 'en-US', playLanguage: 'en-US', script: 'latin' },
  { code: 'eo', name: 'Esperanto', nativeName: 'Esperanto', translateCode: 'eo', script: 'latin' },
  { code: 'et', name: 'Estonian', nativeName: 'Eesti', translateCode: 'et', playLanguage: 'et', script: 'latin' },
  { code: 'fi', name: 'Finnish', nativeName: 'Suomi', translateCode: 'fi', appleLocale: 'fi', playLanguage: 'fi-FI', script: 'latin' },
  { code: 'fr-CA', name: 'French (Canada)', nativeName: 'Français (Canada)', translateCode: 'fr', appleLocale: 'fr-CA', playLanguage: 'fr-CA', script: 'latin' },
  { code: 'fr-FR', name: 'French (France)', nativeName: 'Français', translateCode: 'fr', appleLocale: 'fr-FR', playLanguage: 'fr-FR', script: 'latin' },
  { code: 'gl', name: 'Galician', nativeName: 'Galego', translateCode: 'gl', playLanguage: 'gl-ES', script: 'latin' },
  { code: 'de-DE', name: 'German', nativeName: 'Deutsch', translateCode: 'de', appleLocale: 'de-DE', playLanguage: 'de-DE', script: 'latin' },
  { code: 'el', name: 'Greek', nativeName: 'Ελληνικά', translateCode: 'el', appleLocale: 'el', playLanguage: 'el-GR', script: 'greek' },
  // Play still uses the pre-1989 ISO code for Hebrew. Apple does not.
  { code: 'he', name: 'Hebrew', nativeName: 'עברית', translateCode: 'he', appleLocale: 'he', playLanguage: 'iw-IL', rtl: true, script: 'hebrew' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', translateCode: 'hi', appleLocale: 'hi', playLanguage: 'hi-IN', script: 'devanagari' },
  { code: 'hu', name: 'Hungarian', nativeName: 'Magyar', translateCode: 'hu', appleLocale: 'hu', playLanguage: 'hu-HU', script: 'latin' },
  { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia', translateCode: 'id', appleLocale: 'id', playLanguage: 'id', script: 'latin' },
  { code: 'ga', name: 'Irish', nativeName: 'Gaeilge', translateCode: 'ga', script: 'latin' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano', translateCode: 'it', appleLocale: 'it', playLanguage: 'it-IT', script: 'latin' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', translateCode: 'ja', appleLocale: 'ja', playLanguage: 'ja-JP', script: 'cjk' },
  { code: 'ko', name: 'Korean', nativeName: '한국어', translateCode: 'ko', appleLocale: 'ko', playLanguage: 'ko-KR', script: 'cjk' },
  { code: 'ky', name: 'Kyrgyz', nativeName: 'Кыргызча', translateCode: 'ky', script: 'cyrillic' },
  { code: 'lv', name: 'Latvian', nativeName: 'Latviešu', translateCode: 'lv', playLanguage: 'lv', script: 'latin' },
  { code: 'lt', name: 'Lithuanian', nativeName: 'Lietuvių', translateCode: 'lt', playLanguage: 'lt', script: 'latin' },
  { code: 'ms', name: 'Malay', nativeName: 'Bahasa Melayu', translateCode: 'ms', appleLocale: 'ms', playLanguage: 'ms', script: 'latin' },
  { code: 'no', name: 'Norwegian', nativeName: 'Norsk', translateCode: 'nb', appleLocale: 'no', playLanguage: 'no-NO', script: 'latin' },
  { code: 'fa', name: 'Persian', nativeName: 'فارسی', translateCode: 'fa', playLanguage: 'fa', rtl: true, script: 'arabic' },
  { code: 'pl', name: 'Polish', nativeName: 'Polski', translateCode: 'pl', appleLocale: 'pl', playLanguage: 'pl-PL', script: 'latin' },
  { code: 'pt-BR', name: 'Portuguese (Brazil)', nativeName: 'Português (Brasil)', translateCode: 'pt-BR', appleLocale: 'pt-BR', playLanguage: 'pt-BR', script: 'latin' },
  { code: 'pt-PT', name: 'Portuguese (Portugal)', nativeName: 'Português', translateCode: 'pt', appleLocale: 'pt-PT', playLanguage: 'pt-PT', script: 'latin' },
  { code: 'ro', name: 'Romanian', nativeName: 'Română', translateCode: 'ro', appleLocale: 'ro', playLanguage: 'ro', script: 'latin' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', translateCode: 'ru', appleLocale: 'ru', playLanguage: 'ru-RU', script: 'cyrillic' },
  { code: 'sr', name: 'Serbian', nativeName: 'Српски', translateCode: 'sr', playLanguage: 'sr', script: 'cyrillic' },
  { code: 'sk', name: 'Slovak', nativeName: 'Slovenčina', translateCode: 'sk', appleLocale: 'sk', playLanguage: 'sk', script: 'latin' },
  { code: 'sl', name: 'Slovenian', nativeName: 'Slovenščina', translateCode: 'sl', playLanguage: 'sl', script: 'latin' },
  { code: 'es-MX', name: 'Spanish (Latin America)', nativeName: 'Español (Latinoamérica)', translateCode: 'es', appleLocale: 'es-MX', playLanguage: 'es-419', script: 'latin' },
  { code: 'es-ES', name: 'Spanish (Spain)', nativeName: 'Español (España)', translateCode: 'es', appleLocale: 'es-ES', playLanguage: 'es-ES', script: 'latin' },
  { code: 'sw', name: 'Swahili', nativeName: 'Kiswahili', translateCode: 'sw', playLanguage: 'sw', script: 'latin' },
  { code: 'sv', name: 'Swedish', nativeName: 'Svenska', translateCode: 'sv', appleLocale: 'sv', playLanguage: 'sv-SE', script: 'latin' },
  // Play files Tagalog under Filipino, which is the standardised register of it.
  { code: 'tl', name: 'Tagalog', nativeName: 'Tagalog', translateCode: 'tl', playLanguage: 'fil', script: 'latin' },
  { code: 'th', name: 'Thai', nativeName: 'ไทย', translateCode: 'th', appleLocale: 'th', playLanguage: 'th', script: 'thai' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe', translateCode: 'tr', appleLocale: 'tr', playLanguage: 'tr-TR', script: 'latin' },
  { code: 'uk', name: 'Ukrainian', nativeName: 'Українська', translateCode: 'uk', appleLocale: 'uk', playLanguage: 'uk', script: 'cyrillic' },
  { code: 'ur', name: 'Urdu', nativeName: 'اردو', translateCode: 'ur', playLanguage: 'ur', rtl: true, script: 'arabic' },
  { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt', translateCode: 'vi', appleLocale: 'vi', playLanguage: 'vi', script: 'latin' },
];

const BY_CODE = new Map(LOCALES.map((locale) => [locale.code, locale]));

export function getLocaleDef(code: string): LocaleDef | undefined {
  return BY_CODE.get(code);
}

/** What speakers call the language. Falls back to the raw code. */
export function localeName(code: string): string {
  return BY_CODE.get(code)?.nativeName || code;
}

/** 'Deutsch (de-DE)'. The code stays visible because exports are named by it. */
export function localeLabel(code: string): string {
  const def = BY_CODE.get(code);
  return def ? `${def.nativeName} (${def.code})` : code;
}
