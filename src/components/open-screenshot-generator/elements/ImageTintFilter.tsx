"use client";
import React from 'react';
import type { ImageTint } from '@/lib/elementStyle';

/**
 * The `<filter>` definition behind an image tint, rendered next to the picture
 * it tints (see imageTint in src/lib/elementStyle.ts for why it is a filter).
 *
 * It lives INSIDE the element it belongs to, deliberately: html-to-image
 * rasterizes by cloning one node, so a definition parked elsewhere in the
 * document would not be in the clone and every export would come back untinted.
 * It must not be `display: none` and must not carry `data-export-exclude` for
 * the same reason.
 *
 * Two pictures with the same tint produce the same id and therefore the same
 * definition twice. That is fine: they are identical, and a reference resolves
 * to the first, which is what a shared definition would have done anyway.
 */
export function ImageTintFilter({ tint }: { tint: ImageTint }) {
  return (
    <svg
      width="0"
      height="0"
      aria-hidden
      focusable="false"
      style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}
    >
      <defs>
        {/* sRGB, not the linearRGB filters default: the colour has to come out
            as the one the user picked. */}
        <filter id={tint.id} colorInterpolationFilters="sRGB">
          {/* Flooded at FULL opacity and mixed below, not flooded at `opacity`
              and stacked on top. Stacking is an over-composite, which adds
              alpha: a partly transparent pixel comes out more opaque than it
              went in (only a=0 and a=1 survive it unchanged), so a soft edge
              thickens, the drop-shadow is cast from the wrong silhouette, and
              the canvas compositor in videoExport disagrees with the DOM. */}
          <feFlood floodColor={tint.color} floodOpacity={1} result="tint" />
          {/* Clip the flood to the pixels the picture actually painted. */}
          <feComposite in="tint" in2="SourceAlpha" operator="in" result="clipped" />
          {/* A straight weighted mix of the two, premultiplied: the alpha comes
              out as s*a + (1-s)*a, which is just a. Measured identical to the
              canvas path's source-atop at every alpha from 0 to 1. */}
          <feComposite
            in="clipped"
            in2="SourceGraphic"
            operator="arithmetic"
            k1={0}
            k2={tint.opacity}
            k3={1 - tint.opacity}
            k4={0}
          />
        </filter>
      </defs>
    </svg>
  );
}
