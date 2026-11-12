"use client";

import React from 'react';
import type { ArtboardState } from '@/types/artboard';
import { iphoneAreaFor, iphoneHeaderButtonsFor, safeAreaFor } from '@/lib/creative/specs';
import { useEditorPreference } from '@/lib/editorPreferences';

const SAFE = '#34d399';
const IPHONE = '#38bdf8';

/**
 * The guides drawn over an App Store header or search artboard.
 *
 * The green box is Apple's art safe area, the part every device shows. The
 * blue outline is what an iPhone shows, which is far more: a header's full
 * height and most of its width, and search art from its top down to the
 * bottom of the card. Past the blue outline the board is shaded heavily,
 * because an iPhone cuts that part off. Between the two it is shaded lightly:
 * an iPhone shows it, and some other device does not. On header art two dashed
 * circles mark the back and share buttons iOS floats over the top corners of
 * what the iPhone shows.
 *
 * A sibling of the `.artboard` node like the collab marks, never a child, so
 * the exporter never sees it, and drawn in artboard pixels with the strokes
 * and labels divided by the screen scale so they stay the same size at any
 * zoom. The colours are literal for the same reason the marquee's are: out
 * here the board's forced light palette does not apply.
 */
export function CreativeSafeAreaOverlay({
  board,
  screenScale,
  displayScale,
}: {
  board: Pick<ArtboardState, 'creativeAsset' | 'size'>;
  /** Screen pixels per artboard pixel, zoom included. */
  screenScale: number;
  /** The board's own transform scale on the canvas. */
  displayScale: number;
}) {
  const [visible] = useEditorPreference('creativeSafeArea');
  const safe = safeAreaFor(board);
  const iphone = iphoneAreaFor(board);
  if (!visible || !safe || !iphone) return null;
  // One screen pixel, in artboard pixels.
  const px = 1 / (screenScale || displayScale);
  const buttons = iphoneHeaderButtonsFor(board);
  // Wide enough to shade the whole board from any box inside it.
  const spread = board.size.width + board.size.height;
  const label: React.CSSProperties = {
    position: 'absolute',
    padding: `${2 * px}px ${6 * px}px`,
    fontSize: `${11 * px}px`,
    lineHeight: 1.3,
    fontWeight: 600,
    letterSpacing: '0.02em',
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
    whiteSpace: 'nowrap',
  };

  return (
    <div
      data-export-exclude
      aria-hidden
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: `${board.size.width}px`,
        height: `${board.size.height}px`,
        transform: `scale(${displayScale})`,
        transformOrigin: 'top left',
        pointerEvents: 'none',
        overflow: 'hidden',
        // Above the board, below the collab marks and the marquee.
        zIndex: 4,
      }}
    >
      {/* Where this box meets the edge of the board its outline falls outside
          and is clipped, so only the sides an iPhone cuts along are drawn. */}
      <div
        style={{
          position: 'absolute',
          left: `${iphone.x}px`,
          top: `${iphone.y}px`,
          width: `${iphone.width}px`,
          height: `${iphone.height}px`,
          outline: `${1.5 * px}px dashed ${IPHONE}`,
          boxShadow: `0 0 0 ${spread}px rgba(15, 23, 42, 0.34)`,
        }}
      >
        <span
          style={{
            ...label,
            left: 0,
            bottom: 0,
            color: '#082f49',
            background: IPHONE,
            borderRadius: `0 ${3 * px}px 0 0`,
          }}
        >
          Shown on an iPhone
        </span>
      </div>
      <div
        style={{
          position: 'absolute',
          left: `${safe.x}px`,
          top: `${safe.y}px`,
          width: `${safe.width}px`,
          height: `${safe.height}px`,
          outline: `${1.5 * px}px dashed ${SAFE}`,
          boxShadow: `0 0 0 ${spread}px rgba(15, 23, 42, 0.16)`,
        }}
      >
        <span
          style={{
            ...label,
            left: `${-1.5 * px}px`,
            top: 0,
            transform: 'translateY(-100%)',
            color: '#052e16',
            background: SAFE,
            borderRadius: `${3 * px}px ${3 * px}px 0 0`,
          }}
        >
          Art safe area
        </span>
      </div>
      {buttons.map((button, index) => (
        <div
          key={index}
          style={{
            position: 'absolute',
            left: `${button.x}px`,
            top: `${button.y}px`,
            width: `${button.width}px`,
            height: `${button.height}px`,
            borderRadius: '50%',
            border: `${1.5 * px}px dashed ${IPHONE}`,
            background: 'rgba(56, 189, 248, 0.14)',
          }}
        />
      ))}
    </div>
  );
}
