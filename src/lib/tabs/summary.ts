// What a tab knows about its project without holding the project.
//
// A sleeping tab has nothing in memory, and the strip still has to draw it: its
// colour chip and its hover card read this, which is a handful of numbers and
// one CSS background, small enough to keep in the session for every tab.

import type { ArtboardState } from '@/types/artboard';
import { artboardBackground } from '@/lib/artboardBackground';
import { getProjectLocales } from '@/lib/i18n/localization';

export interface TabSummary {
  artboards: number;
  /** The first artboard's size, in its own pixels. */
  width: number;
  height: number;
  /** The first artboard's background as CSS, for the colour chip on the tab. */
  accent: string;
  /** Languages beyond the base one. */
  languages: number;
}

/** The chip a project with no artboards (or no colour) gets. */
export const NEUTRAL_ACCENT = 'hsl(var(--muted-foreground) / 0.35)';

export function summarizeProject(artboards: readonly ArtboardState[]): TabSummary {
  const first = artboards[0];
  if (!first) return { artboards: 0, width: 0, height: 0, accent: NEUTRAL_ACCENT, languages: 0 };
  const background = artboardBackground(first);
  return {
    artboards: artboards.length,
    width: Math.round(first.size?.width ?? 0),
    height: Math.round(first.size?.height ?? 0),
    accent: background.backgroundImage !== 'none' ? background.backgroundImage : background.backgroundColor,
    languages: getProjectLocales(artboards as ArtboardState[]).length,
  };
}

/** Two summaries that would draw the same tab. Keeps a commit from re-rendering the strip. */
export function sameSummary(a: TabSummary | undefined, b: TabSummary | undefined): boolean {
  if (!a || !b) return a === b;
  return (
    a.artboards === b.artboards &&
    a.width === b.width &&
    a.height === b.height &&
    a.accent === b.accent &&
    a.languages === b.languages
  );
}
