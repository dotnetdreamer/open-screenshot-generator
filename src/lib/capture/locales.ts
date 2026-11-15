/**
 * Which language a device opens the app in, for each of the project's
 * languages.
 *
 * iOS takes a language ID for `-AppleLanguages` ("de-DE", "zh-Hans") and,
 * when the code names a country, a locale for `-AppleLocale` ("de_DE"), so
 * dates and numbers follow too. Android takes a language tag for the app's own
 * language setting; Google Play's code is the closer one there ("zh-CN" for
 * Simplified Chinese, which Android reads as zh-Hans-CN).
 */

import { getLocaleDef } from '@/lib/i18n/locales';
import type { CapturePlatform } from './types';

export interface AppLanguage {
  language: string;
  region?: string;
}

const TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$/;

function clean(code: string): string | null {
  const tag = code.trim().replace(/_/g, '-');
  return TAG.test(tag) ? tag : null;
}

/** The launch language for one project language, or null for a code no device takes. */
export function appLanguageFor(code: string, platform: CapturePlatform): AppLanguage | null {
  const def = getLocaleDef(code);
  if (platform === 'android') {
    const tag = clean(def?.playLanguage ?? code);
    return tag ? { language: tag } : null;
  }
  const tag = clean(def?.appleLocale ?? code);
  if (!tag) return null;
  const parts = tag.split('-');
  const country = parts.length > 1 ? parts[parts.length - 1] : '';
  // A two letter country ("DE") or a UN region ("419"); a script ("Hans") is not one.
  const region = /^([A-Z]{2}|[0-9]{3})$/.test(country) ? `${parts[0].toLowerCase()}_${country}` : undefined;
  return region ? { language: tag, region } : { language: tag };
}
