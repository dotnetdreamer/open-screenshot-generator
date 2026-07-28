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
