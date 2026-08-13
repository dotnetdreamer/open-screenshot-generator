import { GoogleFont } from '@/types/fonts';

/**
 * Which picker group a face belongs in. Wider than `GoogleFont['script']`
 * because a project can now be exported in Japanese, Hebrew, Thai, Hindi or
 * Bengali, and each of those needs its own family: no Latin face carries those
 * glyphs, so filing them under 'multilingual' would put a face in the list that
 * renders every one of those languages as tofu.
 *
 * It is declared here rather than widened in `@/types/fonts` because that
 * interface is shared and this list is a property of what fontService actually
 * loads. `AppFont` accepts every `GoogleFont`, so callers that still type a list
 * as `GoogleFont[]` keep working.
 */
export type FontScript =
  | 'latin'
  | 'arabic'
  | 'urdu'
  | 'hebrew'
  | 'cjk'
  | 'thai'
  | 'devanagari'
  | 'bengali'
  | 'multilingual';

export interface AppFont extends Omit<GoogleFont, 'script'> {
  script?: FontScript;
}

// Define the Google fonts we want to make available
export const GOOGLE_FONTS: AppFont[] = [
  { family: 'Bricolage Grotesque', variants: ['400', '500', '600', '700'], category: 'sans-serif', fallback: 'sans-serif', script: 'latin' },
  { family: 'Oswald', variants: ['200', '300', '400', '500', '600', '700'], category: 'sans-serif', fallback: 'sans-serif', script: 'latin' },
  { family: 'Bungee', category: 'display', fallback: 'cursive', script: 'latin' },
  { family: 'Almarai', variants: ['300', '400', '700', '800'], category: 'sans-serif', fallback: 'sans-serif', script: 'arabic' },
  { family: 'Ranchers', category: 'display', fallback: 'cursive', script: 'latin' },
  { family: 'Roboto Flex', category: 'sans-serif', fallback: 'sans-serif', script: 'latin' },
  { family: 'DM Serif Display', category: 'serif', fallback: 'serif', script: 'latin' },
  { family: 'Adamina', category: 'serif', fallback: 'serif', script: 'latin' },
  { family: 'Merriweather Sans', variants: ['300', '400', '500', '600', '700', '800'], category: 'sans-serif', fallback: 'sans-serif', script: 'latin' },
  { family: 'Calistoga', category: 'display', fallback: 'cursive', script: 'latin' },
  { family: 'Pacifico', category: 'handwriting', fallback: 'cursive', script: 'latin' },
  { family: 'Baloo 2', variants: ['400', '500', '600', '700', '800'], category: 'display', fallback: 'cursive', script: 'latin' },
  { family: 'Caveat', variants: ['400', '500', '600', '700'], category: 'handwriting', fallback: 'cursive', script: 'latin' },
  { family: 'Fira Sans Condensed', variants: ['100', '200', '300', '400', '500', '600', '700', '800', '900'], category: 'sans-serif', fallback: 'sans-serif', script: 'latin' },
  // Cyrillic and Greek deliberately get no family of their own. Checked against
  // the css2 subset list: Noto Sans, Roboto Flex and Fira Sans Condensed all
  // ship cyrillic and greek, and Oswald, Playfair Display and Unbounded ship
  // cyrillic, so Russian, Ukrainian and Greek already render in the face the
  // design was drawn in. Adding a dedicated family would only download the same
  // glyphs twice and hand the picker a duplicate entry.
  { family: 'Noto Sans', variants: ['100', '200', '300', '400', '500', '600', '700', '800', '900'], category: 'sans-serif', fallback: 'sans-serif', script: 'multilingual' },

  // Display and handwriting faces, for headlines that need more personality
  // than a UI sans. Weight lists have to match what Google Fonts actually
  // serves: css2 rejects the whole request if one axis value is wrong, which
  // would take every other family down with it. Single-weight families are
  // listed without variants on purpose.
  { family: 'Anton', category: 'display', fallback: 'sans-serif', script: 'latin' },
  { family: 'Bebas Neue', category: 'display', fallback: 'sans-serif', script: 'latin' },
  { family: 'Abril Fatface', category: 'display', fallback: 'serif', script: 'latin' },
  { family: 'Alfa Slab One', category: 'display', fallback: 'serif', script: 'latin' },
  { family: 'Lobster', category: 'display', fallback: 'cursive', script: 'latin' },
  { family: 'Righteous', category: 'display', fallback: 'cursive', script: 'latin' },
  { family: 'Titan One', category: 'display', fallback: 'cursive', script: 'latin' },
  { family: 'Luckiest Guy', category: 'display', fallback: 'cursive', script: 'latin' },
  { family: 'Bangers', category: 'display', fallback: 'cursive', script: 'latin' },
  { family: 'Monoton', category: 'display', fallback: 'cursive', script: 'latin' },
  { family: 'Fredoka', variants: ['300', '400', '500', '600', '700'], category: 'display', fallback: 'sans-serif', script: 'latin' },
  { family: 'Unbounded', variants: ['300', '400', '500', '600', '700', '800', '900'], category: 'display', fallback: 'sans-serif', script: 'latin' },
  { family: 'Dancing Script', variants: ['400', '500', '600', '700'], category: 'handwriting', fallback: 'cursive', script: 'latin' },
  { family: 'Great Vibes', category: 'handwriting', fallback: 'cursive', script: 'latin' },
  { family: 'Permanent Marker', category: 'handwriting', fallback: 'cursive', script: 'latin' },
  { family: 'Satisfy', category: 'handwriting', fallback: 'cursive', script: 'latin' },

  { family: 'Playfair Display', variants: ['400', '500', '600', '700', '800', '900'], category: 'serif', fallback: 'serif', script: 'latin' },
  { family: 'Poppins', variants: ['300', '400', '500', '600', '700', '800', '900'], category: 'sans-serif', fallback: 'sans-serif', script: 'latin' },
  { family: 'Space Grotesk', variants: ['300', '400', '500', '600', '700'], category: 'sans-serif', fallback: 'sans-serif', script: 'latin' },
  { family: 'Outfit', variants: ['300', '400', '500', '600', '700', '800', '900'], category: 'sans-serif', fallback: 'sans-serif', script: 'latin' },

  // Arabic fonts
  { family: 'Noto Sans Arabic', variants: ['100', '200', '300', '400', '500', '600', '700', '800', '900'], category: 'sans-serif', fallback: 'sans-serif', script: 'arabic' },
  { family: 'Cairo', variants: ['200', '300', '400', '500', '600', '700', '800', '900'], category: 'sans-serif', fallback: 'sans-serif', script: 'arabic' },
  { family: 'Tajawal', variants: ['200', '300', '400', '500', '700', '800', '900'], category: 'sans-serif', fallback: 'sans-serif', script: 'arabic' },
  { family: 'Amiri', variants: ['400', '700'], category: 'serif', fallback: 'serif', script: 'arabic' },
  { family: 'Scheherazade New', variants: ['400', '500', '600', '700'], category: 'serif', fallback: 'serif', script: 'arabic' },
  { family: 'Markazi Text', variants: ['400', '500', '600', '700'], category: 'serif', fallback: 'serif', script: 'arabic' },
  { family: 'IBM Plex Sans Arabic', variants: ['100', '200', '300', '400', '500', '600', '700'], category: 'sans-serif', fallback: 'sans-serif', script: 'arabic' },
  { family: 'Lateef', variants: ['200', '300', '400', '500', '600', '700', '800'], category: 'serif', fallback: 'serif', script: 'arabic' },
  
  // Urdu fonts (many Arabic fonts also support Urdu). 'Noto Sans Urdu' and
  // 'Jameel Noori Nastaleeq' used to sit here and are not Google Fonts
  // families: css2 answers 400 for either one, so they showed up in every
  // picker, never loaded and never reported anything.
  { family: 'Noto Nastaliq Urdu', variants: ['400', '500', '600', '700'], category: 'serif', fallback: 'serif', script: 'urdu' },

  // Hebrew, Thai, Devanagari and Bengali. No Latin face in this list carries
  // these glyphs, so without them a translated headline rasterizes as whatever
  // the export machine happens to have installed, or as tofu.
  { family: 'Noto Sans Hebrew', variants: ['100', '200', '300', '400', '500', '600', '700', '800', '900'], category: 'sans-serif', fallback: 'sans-serif', script: 'hebrew' },
  { family: 'Noto Sans Thai', variants: ['100', '200', '300', '400', '500', '600', '700', '800', '900'], category: 'sans-serif', fallback: 'sans-serif', script: 'thai' },
  { family: 'Noto Sans Devanagari', variants: ['100', '200', '300', '400', '500', '600', '700', '800', '900'], category: 'sans-serif', fallback: 'sans-serif', script: 'devanagari' },
  { family: 'Noto Sans Bengali', variants: ['100', '200', '300', '400', '500', '600', '700', '800', '900'], category: 'sans-serif', fallback: 'sans-serif', script: 'bengali' },

  // Chinese, Japanese and Korean. Two weights each, on purpose: Google slices a
  // CJK family into roughly 120 unicode-range faces per weight, so every extra
  // weight is another ~30KB of stylesheet for everyone on every load, whether
  // or not the project has a CJK language. 400 and 700 cover body and headline,
  // and the browser picks the nearest of the two for a 500, 600 or 800 element.
  //
  // Even at two weights these five are almost the whole cost of the preload
  // link: measured against the live css2 endpoint, the sheet goes from 10KB to
  // 307KB over the wire. That is the price of a Japanese export that is not
  // tofu, and it is paid eagerly because the export path does not wait for a
  // font to arrive. Loading them on demand is the fix, and it needs the loader
  // to gain a second, later link rather than another entry in this list.
  { family: 'Noto Sans JP', variants: ['400', '700'], category: 'sans-serif', fallback: 'sans-serif', script: 'cjk' },
  { family: 'Noto Sans SC', variants: ['400', '700'], category: 'sans-serif', fallback: 'sans-serif', script: 'cjk' },
  { family: 'Noto Sans TC', variants: ['400', '700'], category: 'sans-serif', fallback: 'sans-serif', script: 'cjk' },
  { family: 'Noto Sans KR', variants: ['400', '700'], category: 'sans-serif', fallback: 'sans-serif', script: 'cjk' },
  { family: 'Noto Serif JP', variants: ['400', '700'], category: 'serif', fallback: 'serif', script: 'cjk' },
];

// Default system fonts to include along with Google fonts
export const SYSTEM_FONTS: AppFont[] = [
  { family: 'Arial', category: 'sans-serif', script: 'latin' },
  { family: 'Verdana', category: 'sans-serif', script: 'latin' },
  { family: 'Helvetica', category: 'sans-serif', script: 'latin' },
  { family: 'Times New Roman', category: 'serif', script: 'latin' },
  { family: 'Courier New', category: 'monospace', script: 'latin' },
  { family: 'Georgia', category: 'serif', script: 'latin' },
  { family: 'Impact', category: 'display', script: 'latin' },
  { family: 'Comic Sans MS', category: 'handwriting', script: 'latin' },
];

// All available fonts
export const ALL_FONTS = [...SYSTEM_FONTS, ...GOOGLE_FONTS];

// Create a Google Fonts URL for preloading
export function createGoogleFontsUrl(fonts: AppFont[] = GOOGLE_FONTS): string {
  // Convert font families to the format needed for Google Fonts URL
  const families = fonts.map(font => {
    const family = font.family.replace(/ /g, '+');
    if (!font.variants || font.variants.length === 0) {
      return family;
    }
    return `${family}:wght@${font.variants.join(';')}`;
  });

  // Return the Google Fonts URL
  return `https://fonts.googleapis.com/css2?${families.map(f => `family=${f}`).join('&')}&display=swap`;
}

// Function to preload Google fonts
export function preloadGoogleFonts(fonts: AppFont[] = GOOGLE_FONTS): void {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = createGoogleFontsUrl(fonts);
  document.head.appendChild(link);
}

// Get font options for select components
export function getFontOptions() {
  return ALL_FONTS.map(font => ({
    value: font.family,
    label: font.family,
    category: font.category || 'sans-serif',
    // What a preview should fall back to before the face has loaded. The
    // category is not usable for this: 'display' and 'handwriting' are not CSS
    // generic families.
    fallback: font.fallback || 'sans-serif',
    script: font.script || 'latin',
  }));
}

// Get fonts by script
export function getFontsByScript(script: FontScript) {
  return ALL_FONTS.filter(font => font.script === script);
}

// Get grouped font options by script. Latin splits again by category, because
// the decorative faces are what people scroll for and a flat 30-item list
// buries them among the UI sans.
export function getGroupedFontOptions() {
  const fonts = getFontOptions();
  const isSystem = (family: string) => SYSTEM_FONTS.some(sf => sf.family === family);
  const isDecorative = (category: string) => category === 'display' || category === 'handwriting';
  const latin = fonts.filter(font => font.script === 'latin' && !isSystem(font.value));
  return {
    system: fonts.filter(font => isSystem(font.value)),
    display: latin.filter(font => isDecorative(font.category)),
    latin: latin.filter(font => !isDecorative(font.category)),
    arabic: fonts.filter(font => font.script === 'arabic'),
    urdu: fonts.filter(font => font.script === 'urdu'),
    hebrew: fonts.filter(font => font.script === 'hebrew'),
    cjk: fonts.filter(font => font.script === 'cjk'),
    thai: fonts.filter(font => font.script === 'thai'),
    devanagari: fonts.filter(font => font.script === 'devanagari'),
    bengali: fonts.filter(font => font.script === 'bengali'),
    multilingual: fonts.filter(font => font.script === 'multilingual'),
  };
}
