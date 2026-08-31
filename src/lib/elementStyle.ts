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
 * A colour tint over a picture, as an SVG filter (issue #33).
 *
 * The obvious implementation, a coloured div over the image, is wrong in three
 * ways: it paints over the empty bars an `objectFit: contain` leaves, it turns
 * a cut-out PNG into a coloured rectangle, and it changes the silhouette the
 * element's own drop-shadow is computed from. Flooding the tint colour and
 * compositing it `in` SourceAlpha tints exactly the pixels the browser actually
 * painted, so every objectFit and every alpha channel is handled for free and
 * nothing needs the image's natural size.
 *
 * It stays a filter on the `<img>` rather than a CSS background or a mask,
 * because those carry no `decoding` attribute and WebKit would drop them from
 * the exported PNG (see the header of src/lib/exportRaster.ts). Verified
 * through the repo's html-to-image in both Chromium and WebKit.
 */
export interface ImageTint {
  id: string;
  color: string;
  /** 0..1 */
  opacity: number;
}

/**
 * The tint for a pair of values, or null when there is none.
 *
 * The id is derived from the VALUES, never from an element id: two layers
 * carrying the same tint then share one `<filter>` definition, and the id is
 * identical on the server, on the client and inside an export clone, which a
 * `useId` would not be.
 */
export function imageTint(color?: string, opacity?: number): ImageTint | null {
  if (typeof color !== 'string' || !color.trim()) return null;
  if (typeof opacity !== 'number' || !(opacity > 0)) return null;
  const strength = Math.min(1, opacity);
  return {
    id: `osg-tint-${hash32(`${color.trim()}|${strength}`)}`,
    color: color.trim(),
    opacity: strength,
  };
}

/** `filter: url(#id)` for a tint, or undefined so the property is left off. */
export function imageTintFilter(tint: ImageTint | null): string | undefined {
  return tint ? `url(#${tint.id})` : undefined;
}
