// One definition of "what colour is this artboard".
//
// A half-filled backgroundGradient is the failure mode worth designing around:
// `linear-gradient(undefineddeg, ...)` is invalid CSS, so the browser computes
// background-image: none and the board renders — and exports — flat white with
// no error anywhere. Projects reach us with one from older saves, imported
// bundles, hand-written template JSON and MCP clients, so the renderer fills
// the gaps instead of dropping the background on the floor.

import type { ArtboardState } from '@/types/artboard';

export const DEFAULT_GRADIENT = { color1: '#00F260', color2: '#0575E6', angle: 45 };

export type PartialGradient = Partial<NonNullable<ArtboardState['backgroundGradient']>> | null | undefined;

/** A complete gradient, with defaults standing in for anything missing. */
export function normalizeGradient(gradient?: PartialGradient) {
  return {
    color1:
      typeof gradient?.color1 === 'string' && gradient.color1 ? gradient.color1 : DEFAULT_GRADIENT.color1,
    color2:
      typeof gradient?.color2 === 'string' && gradient.color2 ? gradient.color2 : DEFAULT_GRADIENT.color2,
    angle:
      typeof gradient?.angle === 'number' && Number.isFinite(gradient.angle)
        ? gradient.angle
        : DEFAULT_GRADIENT.angle,
  };
}

/**
 * The artboard background as a colour plus (for a gradient) an image layer.
 *
 * Kept separate rather than returning the `background` shorthand because the
 * PNG export needs the two halves individually: html-to-image takes a
 * `backgroundColor` option and applies its `style` option to the clone last, so
 * re-stating the gradient there is what guarantees the capture matches the
 * canvas instead of relying on the clone having carried the computed style over.
 */
export function artboardBackground(artboard: {
  backgroundType?: ArtboardState['backgroundType'];
  backgroundGradient?: ArtboardState['backgroundGradient'];
  backgroundColor?: string;
}): { backgroundColor: string; backgroundImage: string } {
  if (artboard.backgroundType === 'gradient') {
    const { color1, color2, angle } = normalizeGradient(artboard.backgroundGradient);
    return {
      // The first stop as the colour layer, so edge antialiasing blends into
      // the gradient rather than into white.
      backgroundColor: color1,
      backgroundImage: `linear-gradient(${angle}deg, ${color1}, ${color2})`,
    };
  }
  const solid =
    !artboard.backgroundColor ||
    artboard.backgroundColor.toLowerCase().includes('var(') ||
    artboard.backgroundColor.toLowerCase().includes('hsl(')
      ? 'white'
      : artboard.backgroundColor;
  return { backgroundColor: solid, backgroundImage: 'none' };
}
