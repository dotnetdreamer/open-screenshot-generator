export interface GoogleFont {
  family: string;
  variants?: string[];
  category?: string;
  fallback?: string;
  script?: 'latin' | 'arabic' | 'urdu' | 'multilingual';
}

export type FontCategory = 'sans-serif' | 'serif' | 'display' | 'handwriting' | 'monospace';

export const FONT_CATEGORIES: Record<FontCategory, string> = {
  'sans-serif': 'Sans Serif',
  'serif': 'Serif',
  'display': 'Display',
  'handwriting': 'Handwriting',
  'monospace': 'Monospace',
};
