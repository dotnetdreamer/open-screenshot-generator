"use client";
import React from 'react';
import type { ImageTint } from '@/lib/elementStyle';

/**
 * The `<filter>` behind an image element's tint (see imageTint in
 * src/lib/elementStyle.ts for the maths and why it is not a coloured div).
 *
 * It lives INSIDE the element it belongs to, deliberately: html-to-image
 * rasterizes by cloning one node, so a definition parked elsewhere in the
 * document would not be in the clone and every export would come back untinted.
 * It must not be `display: none` and must not carry `data-export-exclude` for
 * the same reason.
 *
 * The region is pinned to the source box. A filter's default region is 120% of
 * it and the tint never paints outside the picture, so the default was a
 * surface 44% bigger than anything that could appear in it.
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
        <filter
          id={tint.id}
          colorInterpolationFilters="sRGB"
          x="0%"
          y="0%"
          width="100%"
          height="100%"
        >
          {/* One pass, in place: each channel mixed toward the tint by
              `opacity`, alpha passed through untouched. Measured identical to
              the canvas compositor at every alpha from 0 to 1.

              The id is stable per element, so dragging the strength only
              rewrites these numbers. Deriving it from the VALUES instead meant
              a new <filter> node and a new `filter:` property on every step,
              which WebKit answers by re-filtering the whole picture from
              scratch: 1824ms a step against 363ms, measured at dpr 2. */}
          <feColorMatrix
            type="matrix"
            values={[
              1 - tint.opacity, 0, 0, 0, tint.opacity * (tint.rgb?.r ?? 0),
              0, 1 - tint.opacity, 0, 0, tint.opacity * (tint.rgb?.g ?? 0),
              0, 0, 1 - tint.opacity, 0, tint.opacity * (tint.rgb?.b ?? 0),
              0, 0, 0, 1, 0,
            ].join(' ')}
          />
        </filter>
      </defs>
    </svg>
  );
}
