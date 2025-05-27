import { GoogleFont } from '@/types/fonts';

// Define the Google fonts we want to make available
export const GOOGLE_FONTS: GoogleFont[] = [
  { family: 'Bricolage Grotesque', variants: ['400', '500', '600', '700'], category: 'sans-serif', fallback: 'sans-serif' },
  { family: 'Oswald', variants: ['200', '300', '400', '500', '600', '700'], category: 'sans-serif', fallback: 'sans-serif' },
  { family: 'Bungee', category: 'display', fallback: 'cursive' },
  { family: 'Almarai', variants: ['300', '400', '700', '800'], category: 'sans-serif', fallback: 'sans-serif' },
  { family: 'Ranchers', category: 'display', fallback: 'cursive' },
  { family: 'Roboto Flex', category: 'sans-serif', fallback: 'sans-serif' },
  { family: 'DM Serif Display', category: 'serif', fallback: 'serif' },
  { family: 'Adamina', category: 'serif', fallback: 'serif' },
  { family: 'Merriweather Sans', variants: ['300', '400', '500', '600', '700', '800'], category: 'sans-serif', fallback: 'sans-serif' },
  { family: 'Calistoga', category: 'display', fallback: 'cursive' },
  { family: 'Fira Sans Condensed', variants: ['100', '200', '300', '400', '500', '600', '700', '800', '900'], category: 'sans-serif', fallback: 'sans-serif' },
  { family: 'Noto Sans', variants: ['100', '200', '300', '400', '500', '600', '700', '800', '900'], category: 'sans-serif', fallback: 'sans-serif' },
];

// Default system fonts to include along with Google fonts
export const SYSTEM_FONTS: GoogleFont[] = [
  { family: 'Arial', category: 'sans-serif' },
  { family: 'Verdana', category: 'sans-serif' },
  { family: 'Helvetica', category: 'sans-serif' },
  { family: 'Times New Roman', category: 'serif' },
  { family: 'Courier New', category: 'monospace' },
  { family: 'Georgia', category: 'serif' },
  { family: 'Impact', category: 'display' },
  { family: 'Comic Sans MS', category: 'handwriting' },
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
  }));
}
