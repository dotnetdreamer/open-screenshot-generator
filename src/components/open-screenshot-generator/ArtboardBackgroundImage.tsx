"use client";
import React from 'react';
import { artboardBackgroundImageBox } from '@/lib/artboardBackground';
import { useImageSrc } from '@/lib/mediaStore';
import { withBasePath } from '@/lib/basePath';
import { imageTint } from '@/lib/elementStyle';
import type { ArtboardState } from '@/types/artboard';

/**
 * The board's background picture, as a real <img> under every element, plus the
 * scrim that holds it back.
 *
 * An <img> rather than a CSS background-image on purpose. html-to-image
 * rasterizes by serializing the board into an SVG, and WebKit paints that SVG
 * without waiting for its subresources to decode; the fix is a decoding="sync"
 * attribute, which only an <img> can carry. A CSS background would look right
 * on the canvas and be missing from the exported PNG on macOS, with nothing
 * reporting it. The full story is in the header of src/lib/exportRaster.ts.
 *
 * Mounted in BOTH render sites (Artboard and StaticArtboard), because those are
 * the two places an artboard is ever drawn.
 */
export function ArtboardBackgroundImage({ artboard }: { artboard: ArtboardState }) {
  // asset:<id> resolves to the one cached object URL shared by every board of a
  // span; anything else passes through. undefined while it is still loading, and
  // when the row is gone, so both fall back to the board's ground colour.
  const resolved = useImageSrc(artboard.backgroundImage);
  if (!artboard.backgroundImage || !resolved) return null;

  const { left, width, height } = artboardBackgroundImageBox(artboard);
  const tint = imageTint(artboard.backgroundImageTintColor, artboard.backgroundImageTintOpacity);

  return (
    <>
      <img
        src={withBasePath(resolved)}
        alt=""
        aria-hidden
        draggable={false}
        style={{
          position: 'absolute',
          top: 0,
          left: `${left}px`,
          width: `${width}px`,
          height: `${height}px`,
          // Tailwind's preflight caps every img at max-width:100%, which would
          // clamp a slice back to one board's width and show the wrong crop.
          maxWidth: 'none',
          maxHeight: 'none',
          objectFit: artboard.backgroundImageFit || 'cover',
          // The board is the ground, not a layer to be picked up: clicks and
          // drags belong to the board and to the elements over it.
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      />
      {tint && (
        /**
         * A scrim across the BOARD, not a filter on the picture.
         *
         * An image LAYER tints through an SVG filter, which follows the alpha
         * channel exactly. That is the right tool for a cut-out at layer size
         * and the wrong one here: a background picture is millions of pixels (a
         * three board split is ~11MP, four times that on a Retina display) and
         * WebKit re-filters the whole thing on every change. Measured at dpr 2
         * while dragging the strength, per step: 1824ms filtering the picture
         * against 33ms for this div. The desktop app is a WKWebView, so that is
         * a frozen editor against a smooth one.
         *
         * It covers the board rather than only the picture, which is what a
         * background scrim should do anyway: the point of it is that text on
         * top stays readable, and that includes wherever the ground colour
         * shows through a contained or part transparent picture.
         */
        <div
          aria-hidden
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: tint.color,
            opacity: tint.opacity,
            pointerEvents: 'none',
          }}
        />
      )}
    </>
  );
}
