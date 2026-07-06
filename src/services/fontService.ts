import { GoogleFont } from '@/types/fonts';

// Define the Google fonts we want to make available
export const GOOGLE_FONTS: GoogleFont[] = [
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
  { family: 'Fira Sans Condensed', variants: ['100', '200', '300', '400', '500', '600', '700', '800', '900'], category: 'sans-serif', fallback: 'sans-serif', script: 'latin' },
  { family: 'Noto Sans', variants: ['100', '200', '300', '400', '500', '600', '700', '800', '900'], category: 'sans-serif', fallback: 'sans-serif', script: 'multilingual' },
  
  // Arabic fonts
  { family: 'Noto Sans Arabic', variants: ['100', '200', '300', '400', '500', '600', '700', '800', '900'], category: 'sans-serif', fallback: 'sans-serif', script: 'arabic' },
  { family: 'Cairo', variants: ['200', '300', '400', '500', '600', '700', '800', '900'], category: 'sans-serif', fallback: 'sans-serif', script: 'arabic' },
  { family: 'Tajawal', variants: ['200', '300', '400', '500', '700', '800', '900'], category: 'sans-serif', fallback: 'sans-serif', script: 'arabic' },
  { family: 'Amiri', variants: ['400', '700'], category: 'serif', fallback: 'serif', script: 'arabic' },
  { family: 'Scheherazade New', variants: ['400', '500', '600', '700'], category: 'serif', fallback: 'serif', script: 'arabic' },
  { family: 'Markazi Text', variants: ['400', '500', '600', '700'], category: 'serif', fallback: 'serif', script: 'arabic' },
  { family: 'IBM Plex Sans Arabic', variants: ['100', '200', '300', '400', '500', '600', '700'], category: 'sans-serif', fallback: 'sans-serif', script: 'arabic' },
  { family: 'Lateef', variants: ['200', '300', '400', '500', '600', '700', '800'], category: 'serif', fallback: 'serif', script: 'arabic' },
  
  // Urdu fonts (many Arabic fonts also support Urdu)
  { family: 'Noto Nastaliq Urdu', variants: ['400', '500', '600', '700'], category: 'serif', fallback: 'serif', script: 'urdu' },
  { family: 'Noto Sans Urdu', variants: ['100', '200', '300', '400', '500', '600', '700', '800', '900'], category: 'sans-serif', fallback: 'sans-serif', script: 'urdu' },
  { family: 'Jameel Noori Nastaleeq', variants: ['400'], category: 'serif', fallback: 'serif', script: 'urdu' },
];

// Default system fonts to include along with Google fonts
export const SYSTEM_FONTS: GoogleFont[] = [
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
export function createGoogleFontsUrl(fonts: GoogleFont[] = GOOGLE_FONTS): string {
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
export function preloadGoogleFonts(fonts: GoogleFont[] = GOOGLE_FONTS): void {
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
    script: font.script || 'latin',
  }));
}

// Get fonts by script
export function getFontsByScript(script: 'latin' | 'arabic' | 'urdu' | 'multilingual') {
  return ALL_FONTS.filter(font => font.script === script);
}

// Get grouped font options by script
export function getGroupedFontOptions() {
  const fonts = getFontOptions();
  return {
    system: fonts.filter(font => SYSTEM_FONTS.find(sf => sf.family === font.value)),
    latin: fonts.filter(font => font.script === 'latin' && !SYSTEM_FONTS.find(sf => sf.family === font.value)),
    arabic: fonts.filter(font => font.script === 'arabic'),
    urdu: fonts.filter(font => font.script === 'urdu'),
    multilingual: fonts.filter(font => font.script === 'multilingual'),
  };
}
