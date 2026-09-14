// Shared visual treatment for every element type: opacity, drop shadow and
// blur.
//
// These live on BaseElement rather than on each element's own props so one
// implementation covers text, shapes, images and device mockups at once.
// DraggableElement applies the result to the wrapper that holds the rendered
// element (not to the selection outline or the handles), which means:
//   - a drop-shadow follows the real silhouette — a star casts a star, a
//     transparent PNG casts its subject, an SVG path casts its outline;
//   - html-to-image copies the computed filter/opacity, so canvas and export
//     agree without the exporter knowing anything about these props.
//
// Offsets and radii are in artboard pixels, the same space as position/size.

import type React from 'react';
import type { ArtboardElement, LinearGradient } from '@/types/artboard';
import { hash32 } from '@/lib/i18n/hash';

/** CSS for the element's shared shadow/blur/opacity, or {} when it has none. */
export function elementVisualStyle(element: ArtboardElement): React.CSSProperties {
  const style: React.CSSProperties = {};

  if (typeof element.opacity === 'number' && element.opacity < 1) {
    style.opacity = Math.max(0, element.opacity);
  }

  const filters: string[] = [];
  const shadow = element.shadow;
  if (shadow) {
    const { x = 0, y = 0, blur = 0, color = 'rgba(0,0,0,0.35)' } = shadow;
    filters.push(`drop-shadow(${x}px ${y}px ${Math.max(0, blur)}px ${color})`);
  }
  if (typeof element.blur === 'number' && element.blur > 0) {
    filters.push(`blur(${element.blur}px)`);
  }
  if (filters.length > 0) style.filter = filters.join(' ');

  return style;
}

/** `linear-gradient(...)` for a two-stop gradient, or undefined when unset. */
export function linearGradientCss(gradient?: LinearGradient | null): string | undefined {
  if (!gradient) return undefined;
  const { color1, color2, angle } = gradient;
  // A half-filled gradient renders as `none` and silently flattens the layer,
  // so treat anything incomplete as "no gradient" and let the solid fill show.
  if (typeof color1 !== 'string' || typeof color2 !== 'string' || typeof angle !== 'number') {
    return undefined;
  }
  return `linear-gradient(${angle}deg, ${color1}, ${color2})`;
}

/**
 * A colour tint over a picture (issue #33).
 *
 * The obvious implementation, a coloured div over the image, is wrong in three
 * ways: it paints over the empty bars an `objectFit: contain` leaves, it turns
 * a cut-out PNG into a coloured rectangle, and it changes the silhouette the
 * element's own drop-shadow is computed from. Compositing the colour onto the
 * pixels the browser actually painted handles every objectFit and every alpha
 * channel for free, and needs nothing from the image's natural size.
 *
 * This type carries the VALUES. Where the compositing happens differs by
 * surface, and all three were measured pixel-identical at every alpha:
 * lib/imageTintBake bakes it into the bitmap for the DOM (an SVG filter froze
 * WebKit on a board-sized picture), and videoExport does the same composite on
 * its canvas for the MP4.
 */
export interface ImageTint {
  id: string;
  color: string;
  /** 0..1 */
  opacity: number;
  /**
   * `color` as 0..1 channels, when it is a shape we can read without a DOM.
   *
   * With it the tint is ONE feColorMatrix; without it the renderer falls back
   * to flood-and-composite, which is the same picture but three passes over a
   * full-size surface instead of one in place. That matters: a background
   * picture spanning three phone boards is ~11 megapixels, and the intermediate
   * surfaces alone ran to hundreds of megabytes per repaint.
   */
  rgb: { r: number; g: number; b: number } | null;
}

/**
 * A CSS colour as 0..1 channels, or null for anything we cannot read here.
 *
 * Deliberately not a canvas round trip: this runs during render, including on
 * the server, where there is no document. Covers every shape the app itself
 * writes (the colour input only ever emits #rrggbb) and the usual hand-written
 * ones; a named colour or a modern colour function falls back rather than
 * guessing.
 */
export function parseCssColorChannels(color: string): { r: number; g: number; b: number } | null {
  const value = color.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(value);
  if (hex) {
    const digits = hex[1];
    const wide = digits.length >= 6;
    const at = (i: number) =>
      wide ? parseInt(digits.slice(i * 2, i * 2 + 2), 16) : parseInt(digits[i] + digits[i], 16);
    if (digits.length === 3 || digits.length === 4 || digits.length === 6 || digits.length === 8) {
      return { r: at(0) / 255, g: at(1) / 255, b: at(2) / 255 };
    }
    return null;
  }
  const rgb = /^rgba?\(([^)]+)\)$/.exec(value);
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3);
    if (parts.length !== 3) return null;
    const channel = (raw: string) => {
      const n = parseFloat(raw);
      if (!Number.isFinite(n)) return null;
      return Math.min(1, Math.max(0, raw.includes('%') ? n / 100 : n / 255));
    };
    const [r, g, b] = parts.map(channel);
    if (r === null || g === null || b === null) return null;
    return { r, g, b };
  }
  return null;
}

/**
 * The tint for a pair of values, or null when there is none.
 *
 * `owner` is the id of the thing being tinted, and the filter id is derived
 * from it rather than from the colour and strength. That matters: an id that
 * changes with the values means a new `<filter>` node and a new `filter:`
 * property on the picture on every step of a drag, and WebKit answers that by
 * re-filtering the whole picture from scratch (1824ms a step against 363ms,
 * measured at dpr 2 on a board-sized background). An element id is also stable
 * across an export clone, which a `useId` would not be.
 */
export function imageTint(color?: string, opacity?: number, owner?: string): ImageTint | null {
  if (typeof color !== 'string' || !color.trim()) return null;
  if (typeof opacity !== 'number' || !(opacity > 0)) return null;
  const strength = Math.min(1, opacity);
  const trimmed = color.trim();
  return {
    id: `osg-tint-${hash32(owner || trimmed)}`,
    color: trimmed,
    opacity: strength,
    rgb: parseCssColorChannels(trimmed),
  };
}

/** `filter: url(#id)` for a tint, or undefined so the property is left off. */
export function imageTintFilter(tint: ImageTint | null): string | undefined {
  return tint ? `url(#${tint.id})` : undefined;
}
